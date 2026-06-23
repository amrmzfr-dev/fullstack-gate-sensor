#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <AsyncMqttClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>

#include "secrets.h"

namespace {

constexpr uint8_t kBuzzerPin = 5;
constexpr uint8_t kConfigResetPin = 0;  // BOOT button — hold at startup to force the WiFi setup portal
constexpr char kBuzzerTopic[] = "gate/buzzer";
constexpr char kAckTopic[] = "gate/receiver/ack";
constexpr char kMqttClientId[] = "gate-receiver";
// Bump this with every release that gets copied into backend/wwwroot/firmware/receiver/.
constexpr char kFirmwareVersion[] = "1.3.0";
constexpr char kFirmwareTopic[] = "firmware/receiver/latest";
constexpr unsigned long kBeepOnMs = 1000;    // each beep lasts 1s
constexpr unsigned long kBeepGapMs = 1000;   // 1s gap between beeps within a cycle
constexpr unsigned long kPauseMs = 2000;     // 2s pause after a cycle before looping
constexpr uint8_t kBeepsPerCycle = 5;
constexpr unsigned long kWifiResetHoldMs = 3000;
// Every "on" ping guarantees at least this long of alerting, however brief
// the trigger was — "off" is intentionally ignored for buzzer control (the
// transmitter only sends it for the dashboard log). While the sensor stays
// blocked, the transmitter re-pings before this deadline, pushing it out —
// that's how "still there" keeps the alarm going past the 7s minimum.
constexpr unsigned long kAlertWindowMs = 7000;

enum class BuzzerPhase { kOn, kGap, kPause };

AsyncMqttClient mqttClient;
bool mqttConnected = false;

// Pulsing state — kept separate from "is the alert logically active" so the
// buzzer runs its 3-beeps-then-pause pattern instead of holding one continuous tone.
bool buzzerActive = false;
bool buzzerPinOn = false;
BuzzerPhase buzzerPhase = BuzzerPhase::kOn;
uint8_t beepIndex = 0;
unsigned long lastToggleMs = 0;
unsigned long alertDeadlineMs = 0;

void setBuzzerPin(bool on) {
  buzzerPinOn = on;
  digitalWrite(kBuzzerPin, on ? LOW : HIGH);  // low-level-trigger module
  Serial.printf("[buzzer] pin=%s beepIndex=%u/%u\n", on ? "ON" : "OFF", beepIndex, kBeepsPerCycle);
}

void connectMqtt() {
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCredentials(MQTT_USERNAME, MQTT_PASSWORD);
  mqttClient.setClientId(kMqttClientId);
  mqttClient.connect();
}

// See firmware/transmitter/src/main.cpp's performOta for the same caveat:
// plain HTTP, no signature check beyond the MD5 integrity hash.
void performOta(const String& url, const String& expectedMd5) {
  Serial.printf("OTA: downloading %s\n", url.c_str());

  HTTPClient http;
  if (!http.begin(url)) {
    Serial.println("OTA: failed to begin HTTP request");
    return;
  }

  const int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    Serial.printf("OTA: HTTP GET failed, code=%d\n", httpCode);
    http.end();
    return;
  }

  const int contentLength = http.getSize();
  if (contentLength <= 0) {
    Serial.println("OTA: invalid content length");
    http.end();
    return;
  }

  if (!Update.begin(contentLength)) {
    Serial.printf("OTA: Update.begin failed: %s\n", Update.errorString());
    http.end();
    return;
  }

  if (expectedMd5.length() > 0) {
    Update.setMD5(expectedMd5.c_str());
  }

  const size_t written = Update.writeStream(*http.getStreamPtr());
  if (written != static_cast<size_t>(contentLength)) {
    Serial.printf("OTA: wrote %u of %d bytes\n", static_cast<unsigned>(written), contentLength);
  }

  if (!Update.end() || !Update.isFinished()) {
    Serial.printf("OTA: update failed: %s\n", Update.errorString());
    http.end();
    return;
  }

  Serial.println("OTA: success — restarting into new firmware");
  http.end();
  delay(500);
  ESP.restart();
}

void onFirmwareManifest(char* payload, size_t len) {
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, payload, len)) {
    Serial.println("OTA: failed to parse firmware manifest");
    return;
  }

  const char* version = doc["version"] | "";
  const char* url = doc["url"] | "";
  const char* md5 = doc["md5"] | "";

  if (strlen(version) == 0 || strlen(url) == 0) {
    return;
  }

  if (strcmp(version, kFirmwareVersion) == 0) {
    return;  // already running this version
  }

  Serial.printf("OTA: new firmware available (%s -> %s)\n", kFirmwareVersion, version);
  performOta(String(url), String(md5));
}

void onMqttConnect(bool /*sessionPresent*/) {
  Serial.println("MQTT connected");
  mqttConnected = true;
  mqttClient.subscribe(kBuzzerTopic, 1);
  mqttClient.subscribe(kFirmwareTopic, 1);
  Serial.printf("Subscribed to %s (QoS 1)\n", kBuzzerTopic);
}

void onMqttDisconnect(AsyncMqttClientDisconnectReason reason) {
  Serial.printf("MQTT disconnected (%u)\n", static_cast<unsigned>(reason));
  mqttConnected = false;

  if (WiFi.isConnected()) {
    connectMqtt();
  }
}

void onMqttMessage(char* topic,
                   char* payload,
                   AsyncMqttClientMessageProperties properties,
                   size_t len,
                   size_t /*index*/,
                   size_t /*total*/) {
  if (strcmp(topic, kFirmwareTopic) == 0) {
    onFirmwareManifest(payload, len);
    return;
  }

  if (strcmp(topic, kBuzzerTopic) != 0) {
    return;
  }

  StaticJsonDocument<64> doc;
  const DeserializationError error = deserializeJson(doc, payload, len);
  if (error) {
    Serial.printf("Failed to parse buzzer payload: %s\n", error.c_str());
    return;
  }

  const bool buzzerOn = doc["on"] | false;
  const char* eventId = doc["eventId"] | "";

  if (buzzerOn) {
    alertDeadlineMs = millis() + kAlertWindowMs;  // (re)start or extend the rolling window
    if (!buzzerActive) {
      // Fresh trigger from idle — start the beep pattern from the top. If
      // already alerting, leave the in-flight beep/gap/pause cycle alone so
      // a refresh ping doesn't audibly restart it.
      buzzerActive = true;
      beepIndex = 0;
      buzzerPhase = BuzzerPhase::kOn;
      lastToggleMs = millis();
      setBuzzerPin(true);
    }
  }
  // "off" is intentionally ignored here — see kAlertWindowMs comment above.
  Serial.printf("Buzzer %s (eventId=%s)\n", buzzerOn ? "ON" : "OFF", eventId);

  StaticJsonDocument<96> ackDoc;
  ackDoc["on"] = buzzerOn;
  ackDoc["eventId"] = eventId;

  char ackPayload[96];
  const size_t ackLength = serializeJson(ackDoc, ackPayload, sizeof(ackPayload));
  mqttClient.publish(kAckTopic, 1, false, ackPayload, ackLength);
}

// See firmware/transmitter/src/main.cpp for why WiFi is configured via
// WiFiManager's captive portal instead of being compiled in.
void connectWiFiBlocking() {
  WiFiManager wm;
  wm.setConfigPortalTimeout(180);

  // Require a deliberate 3s hold before wiping saved WiFi credentials.
  // BOOT also has to be held to put the board into flashing mode, and it can
  // still be pressed for a moment after the post-upload reset — a plain
  // instantaneous check here would wipe the real WiFi config on every flash.
  if (digitalRead(kConfigResetPin) == LOW) {
    const unsigned long holdStart = millis();
    while (digitalRead(kConfigResetPin) == LOW && millis() - holdStart < kWifiResetHoldMs) {
      delay(50);
    }
    if (digitalRead(kConfigResetPin) == LOW) {
      Serial.println("BOOT held 3s+ at startup — forcing WiFi setup portal");
      wm.resetSettings();
    }
  }

  Serial.println("Connecting to WiFi (or starting \"GateSensor-Receiver-Setup\" portal)...");
  if (!wm.autoConnect("GateSensor-Receiver-Setup")) {
    Serial.println("WiFi setup timed out — restarting to try again");
    delay(1000);
    ESP.restart();
  }

  Serial.print("WiFi connected, IP: ");
  Serial.println(WiFi.localIP());
}

void onWiFiEvent(WiFiEvent_t event) {
  switch (event) {
#if defined(ARDUINO_EVENT_WIFI_STA_GOT_IP)
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
#else
    case SYSTEM_EVENT_STA_GOT_IP:
#endif
      Serial.println("WiFi got IP — connecting MQTT");
      if (!mqttClient.connected()) {
        connectMqtt();
      }
      break;
#if defined(ARDUINO_EVENT_WIFI_STA_DISCONNECTED)
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
#else
    case SYSTEM_EVENT_STA_DISCONNECTED:
#endif
      Serial.println("WiFi disconnected");
      mqttConnected = false;
      break;
    default:
      break;
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.printf("[boot] firmware=%s kBeepsPerCycle=%u kBeepOnMs=%lu kBeepGapMs=%lu kPauseMs=%lu\n",
                kFirmwareVersion, kBeepsPerCycle, kBeepOnMs, kBeepGapMs, kPauseMs);
  pinMode(kBuzzerPin, OUTPUT);
  setBuzzerPin(false);
  pinMode(kConfigResetPin, INPUT_PULLUP);

  mqttClient.onConnect(onMqttConnect);
  mqttClient.onDisconnect(onMqttDisconnect);
  mqttClient.onMessage(onMqttMessage);

  WiFi.onEvent(onWiFiEvent);
  connectWiFiBlocking();
  // connectMqtt() is NOT called here — see transmitter/src/main.cpp for why.
}

void loop() {
  if (buzzerActive && millis() >= alertDeadlineMs) {
    Serial.println("Safety timeout — no \"off\" received in time, silencing buzzer");
    buzzerActive = false;
    setBuzzerPin(false);
  }

  if (buzzerActive) {
    const unsigned long elapsed = millis() - lastToggleMs;

    switch (buzzerPhase) {
      case BuzzerPhase::kOn:
        if (elapsed >= kBeepOnMs) {
          setBuzzerPin(false);
          beepIndex++;
          buzzerPhase = (beepIndex >= kBeepsPerCycle) ? BuzzerPhase::kPause : BuzzerPhase::kGap;
          lastToggleMs = millis();
        }
        break;
      case BuzzerPhase::kGap:
        if (elapsed >= kBeepGapMs) {
          setBuzzerPin(true);
          buzzerPhase = BuzzerPhase::kOn;
          lastToggleMs = millis();
        }
        break;
      case BuzzerPhase::kPause:
        if (elapsed >= kPauseMs) {
          beepIndex = 0;
          setBuzzerPin(true);
          buzzerPhase = BuzzerPhase::kOn;
          lastToggleMs = millis();
        }
        break;
    }
  } else if (buzzerPinOn) {
    setBuzzerPin(false);
  }

  delay(20);
}
