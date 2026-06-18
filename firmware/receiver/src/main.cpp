#include <Arduino.h>
#include <WiFi.h>
#include <AsyncMqttClient.h>
#include <ArduinoJson.h>

#include "secrets.h"

namespace {

constexpr uint8_t kBuzzerPin = 5;
constexpr char kBuzzerTopic[] = "gate/buzzer";
constexpr char kMqttClientId[] = "gate-receiver";

AsyncMqttClient mqttClient;
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
  mqttClient.subscribe(kBuzzerTopic, 1);
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
  digitalWrite(kBuzzerPin, buzzerOn ? HIGH : LOW);
  Serial.printf("Buzzer %s\n", buzzerOn ? "ON" : "OFF");
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
      connectMqtt();
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
  pinMode(kBuzzerPin, OUTPUT);
  digitalWrite(kBuzzerPin, LOW);

  mqttClient.onConnect(onMqttConnect);
  mqttClient.onDisconnect(onMqttDisconnect);
  mqttClient.onMessage(onMqttMessage);

  WiFi.onEvent(onWiFiEvent);
  connectWiFiBlocking();
  connectMqtt();
}

void loop() {
  delay(100);
}
