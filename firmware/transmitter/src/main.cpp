#include <Arduino.h>
#include <WiFi.h>
#include <AsyncMqttClient.h>
#include <ArduinoJson.h>

#include "secrets.h"

namespace {

constexpr uint8_t kIrSensorPin = 4;
constexpr uint8_t kSimButtonPin = 0;  // BOOT button — simulates the IR sensor when no real sensor is wired
constexpr char kTriggerTopic[] = "gate/trigger";
constexpr char kMqttClientId[] = "gate-transmitter";
constexpr unsigned long kPollIntervalMs = 75;
constexpr unsigned long kDebounceMs = 50;
constexpr unsigned long kCycleMs = 5000;

enum class TransmitterState { Idle, Buzzing, Cooldown };

AsyncMqttClient mqttClient;
TransmitterState state = TransmitterState::Idle;
unsigned long stateDeadlineMs = 0;
bool mqttConnected = false;

void connectMqtt() {
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCredentials(MQTT_USERNAME, MQTT_PASSWORD);
  mqttClient.setClientId(kMqttClientId);
  mqttClient.connect();
}

void onMqttConnect(bool /*sessionPresent*/) {
  Serial.println("MQTT connected");
  mqttConnected = true;
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

void connectWiFiBlocking() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.printf("Connecting to WiFi \"%s\"", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
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
        state = TransmitterState::Buzzing;
        stateDeadlineMs = now + kCycleMs;
      }
      break;

    case TransmitterState::Buzzing:
      if (now >= stateDeadlineMs) {
        publishTrigger("off");
        state = TransmitterState::Cooldown;
        stateDeadlineMs = now + kCycleMs;
      }
      break;

    case TransmitterState::Cooldown:
      if (now >= stateDeadlineMs) {
        if (sensorActive()) {
          publishTrigger("on");
          state = TransmitterState::Buzzing;
          stateDeadlineMs = now + kCycleMs;
        } else {
          state = TransmitterState::Idle;
        }
      }
      break;
  }

  delay(kPollIntervalMs);
}
