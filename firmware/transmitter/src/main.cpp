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
constexpr char kFirmwareVersion[] = "1.2.0";
constexpr char kFirmwareTopic[] = "firmware/transmitter/latest";
constexpr unsigned long kPollIntervalMs = 75;
constexpr unsigned long kDebounceMs = 50;
// Every detected block pings the receiver immediately — no "wait and see if
// it's just a car passing through" delay. The receiver guarantees a full 7s
// alert per ping regardless, so a brief block still gets the full alert.
// While the sensor stays active, re-ping at this interval so the receiver's
// rolling 7s window keeps getting refreshed ("something is still there").
// Must stay comfortably under the receiver's kAlertWindowMs (7000) so a ping
// always lands before the previous one's deadline expires.
constexpr unsigned long kPingIntervalMs = 5000;
constexpr unsigned long kWifiResetHoldMs = 3000;

enum class TransmitterState { Idle, Active };

AsyncMqttClient mqttClient;
TransmitterState state = TransmitterState::Idle;
unsigned long lastPingMs = 0;
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
        publishTrigger("on");
        state = TransmitterState::Active;
        lastPingMs = now;
      }
      break;

    case TransmitterState::Active:
      if (sensorActive()) {
        if (now - lastPingMs >= kPingIntervalMs) {
          publishTrigger("on");  // refresh the receiver's rolling alert window
          lastPingMs = now;
        }
      } else {
        // Logged for the dashboard only — the receiver ignores "off" and
        // always rides out its own 7s window regardless of how this clears.
        publishTrigger("off");
        state = TransmitterState::Idle;
      }
      break;
  }

  delay(kPollIntervalMs);
}
