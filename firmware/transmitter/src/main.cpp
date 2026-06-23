#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <AsyncMqttClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>

#include "secrets.h"

namespace {

constexpr uint8_t kIrSensorPin = 4;
constexpr uint8_t kSimButtonPin = 0;  // BOOT button — simulates the IR sensor when no real sensor is wired
constexpr char kTriggerTopic[] = "gate/trigger";
constexpr char kMqttClientId[] = "gate-transmitter";
// Bump this with every release that gets copied into backend/wwwroot/firmware/transmitter/.
constexpr char kFirmwareVersion[] = "1.1.0";
constexpr char kFirmwareTopic[] = "firmware/transmitter/latest";
constexpr unsigned long kPollIntervalMs = 75;
constexpr unsigned long kDebounceMs = 50;
// A car driving through an already-open gate breaks the beam for well under
// this long — only treat it as a real "something is blocking the gate"
// incident once the sensor has stayed high continuously for kConfirmMs.
constexpr unsigned long kConfirmMs = 5000;
constexpr unsigned long kBuzzMs = 10000;
// The gate takes time to physically open — give it room before re-alerting
// on the same incident instead of buzzing again right as cooldown ends.
constexpr unsigned long kCooldownMs = 15000;
constexpr unsigned long kWifiResetHoldMs = 3000;

enum class TransmitterState { Idle, Confirming, Buzzing, Cooldown };

AsyncMqttClient mqttClient;
TransmitterState state = TransmitterState::Idle;
unsigned long stateDeadlineMs = 0;
unsigned long confirmStartMs = 0;
bool mqttConnected = false;

void connectMqtt() {
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCredentials(MQTT_USERNAME, MQTT_PASSWORD);
  mqttClient.setClientId(kMqttClientId);
  mqttClient.connect();
}

// Downloads the new app image over plain HTTP and writes it to the inactive
// OTA partition. No HTTPS yet, so this trusts whatever the manifest's URL
// points to — fine for now since it's our own VPS, but tighten this with
// HTTPS + the broker already being password-protected before treating it as
// hardened against tampering.
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

void onMqttMessage(char* topic,
                    char* payload,
                    AsyncMqttClientMessageProperties /*properties*/,
                    size_t len,
                    size_t /*index*/,
                    size_t /*total*/) {
  if (strcmp(topic, kFirmwareTopic) == 0) {
    onFirmwareManifest(payload, len);
  }
}

void onMqttConnect(bool /*sessionPresent*/) {
  Serial.println("MQTT connected");
  mqttConnected = true;
  mqttClient.subscribe(kFirmwareTopic, 1);
}

void onMqttDisconnect(AsyncMqttClientDisconnectReason reason) {
  Serial.printf("MQTT disconnected (%u)\n", static_cast<unsigned>(reason));
  mqttConnected = false;

  if (WiFi.isConnected()) {
    connectMqtt();
  }
}

bool publishTrigger(const char* event) {
  StaticJsonDocument<64> doc;
  doc["event"] = event;

  char payload[32];
  const size_t length = serializeJson(doc, payload, sizeof(payload));

  if (!mqttConnected) {
    Serial.printf("MQTT offline — skipped trigger event=%s\n", event);
    return false;
  }

  mqttClient.publish(kTriggerTopic, 1, false, payload, length);
  Serial.printf("Published trigger event=%s\n", event);
  return true;
}

// True if the real IR sensor is HIGH, or the BOOT button is held (simulated
// trigger for testing without the physical sensor wired up — BOOT reads LOW
// when pressed since it has an onboard pull-up).
bool sensorActive() {
  return digitalRead(kIrSensorPin) == HIGH || digitalRead(kSimButtonPin) == LOW;
}

bool debouncedHigh() {
  if (!sensorActive()) {
    return false;
  }

  delay(kDebounceMs);
  return sensorActive();
}

// WiFi credentials are no longer compiled in. WiFiManager tries the last
// saved network first; if that fails (or none is saved yet), it starts a
// "GateSensor-Transmitter-Setup" access point with a captive portal where
// you pick the network and enter the password from a phone/laptop browser.
// Holding the BOOT button down through power-on/reset forces the portal
// back open even if credentials are already saved, as the way to
// reconfigure WiFi later without re-flashing.
void connectWiFiBlocking() {
  WiFiManager wm;
  wm.setConfigPortalTimeout(180);

  // Require a deliberate 3s hold before wiping saved WiFi credentials.
  // BOOT also has to be held to put the board into flashing mode, and it can
  // still be pressed for a moment after the post-upload reset — a plain
  // instantaneous check here would wipe the real WiFi config on every flash.
  if (digitalRead(kSimButtonPin) == LOW) {
    const unsigned long holdStart = millis();
    while (digitalRead(kSimButtonPin) == LOW && millis() - holdStart < kWifiResetHoldMs) {
      delay(50);
    }
    if (digitalRead(kSimButtonPin) == LOW) {
      Serial.println("BOOT held 3s+ at startup — forcing WiFi setup portal");
      wm.resetSettings();
    }
  }

  Serial.println("Connecting to WiFi (or starting \"GateSensor-Transmitter-Setup\" portal)...");
  if (!wm.autoConnect("GateSensor-Transmitter-Setup")) {
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
  pinMode(kIrSensorPin, INPUT_PULLDOWN);
  pinMode(kSimButtonPin, INPUT_PULLUP);

  mqttClient.onConnect(onMqttConnect);
  mqttClient.onDisconnect(onMqttDisconnect);
  mqttClient.onMessage(onMqttMessage);

  WiFi.onEvent(onWiFiEvent);
  connectWiFiBlocking();
  // connectMqtt() is NOT called here — onWiFiEvent's GOT_IP case already
  // triggers it as soon as the IP is obtained (which happens asynchronously
  // during the blocking wait above). Calling it again here raced a second
  // connection with the same client ID, causing mosquitto to repeatedly
  // kick the first session ("session taken over").
}

void loop() {
  const unsigned long now = millis();

  switch (state) {
    case TransmitterState::Idle:
      if (debouncedHigh()) {
        state = TransmitterState::Confirming;
        confirmStartMs = now;
      }
      break;

    case TransmitterState::Confirming:
      if (!sensorActive()) {
        state = TransmitterState::Idle;  // cleared before the confirm window elapsed — treat as a pass-through, not a block
      } else if (now - confirmStartMs >= kConfirmMs) {
        publishTrigger("on");
        state = TransmitterState::Buzzing;
        stateDeadlineMs = now + kBuzzMs;
      }
      break;

    case TransmitterState::Buzzing:
      if (now >= stateDeadlineMs) {
        publishTrigger("off");
        state = TransmitterState::Cooldown;
        stateDeadlineMs = now + kCooldownMs;
      }
      break;

    case TransmitterState::Cooldown:
      if (now >= stateDeadlineMs) {
        if (sensorActive()) {
          // Already a confirmed incident — re-alert immediately, no need to
          // re-run the confirm window for a block that never cleared.
          publishTrigger("on");
          state = TransmitterState::Buzzing;
          stateDeadlineMs = now + kBuzzMs;
        } else {
          state = TransmitterState::Idle;
        }
      }
      break;
  }

  delay(kPollIntervalMs);
}
