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
// Gate-control relay (normally open) wired to the gate motor board's trigger
// input. One brief closure per command; the motor board itself cycles
// open -> stop -> close on successive triggers. GPIO26 is not a strapping pin
// and stays low through boot, so the relay can't chatter on power-up.
constexpr uint8_t kRelayPin = 26;
// Most bare relay modules with an IN pin are ACTIVE-LOW (IN pulled to GND
// closes the relay). If yours closes on 3.3V instead, flip this to true.
constexpr bool kRelayActiveHigh = false;
constexpr unsigned long kRelayPulseDefaultMs = 600;
constexpr char kTriggerTopic[] = "gate/trigger";
// Prefix only — the chip MAC gets appended (see setup) so two units (or an
// impostor) can't collide on one client id and kick each other off the broker.
constexpr char kMqttClientIdPrefix[] = "gate-transmitter-";
// Liveness: retained online/offline status the backend watches. The broker
// publishes kStatusOfflinePayload as our Last Will if we drop uncleanly; we
// publish "online" on connect and refresh it on a timer.
constexpr char kStatusTopic[] = "gate/transmitter/status";
constexpr char kStatusOfflinePayload[] = "{\"online\":false}";
constexpr unsigned long kHeartbeatMs = 30000;
// Bump this with every release that gets copied into backend/wwwroot/firmware/transmitter/.
constexpr char kFirmwareVersion[] = "1.6.0";
constexpr char kFirmwareTopic[] = "firmware/transmitter/latest";
// Retained runtime settings the backend pushes (re-ping interval, debounce).
constexpr char kConfigTopic[] = "gate/transmitter/config";
// One-shot commands from the backend (gate relay pulse).
constexpr char kCommandTopic[] = "gate/transmitter/command";
constexpr unsigned long kPollIntervalMs = 75;
// Defaults below double as the fallback config for an unconfigured unit.
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

// Unique per-device client id, built once from the chip MAC in setup().
String mqttClientId;
// Last time we published a liveness heartbeat (main task only).
unsigned long lastHeartbeatMs = 0;

// Runtime settings pushed retained from the backend over gate/transmitter/config
// and applied live. Defaults match the old compiled-in constants. loop() owns
// the live copy; the callback stages the pending one under stateMux.
unsigned long pingIntervalMs = kPingIntervalMs;
unsigned long debounceMs = kDebounceMs;
volatile bool configPending = false;
volatile unsigned long pendingPingIntervalMs = kPingIntervalMs;
volatile unsigned long pendingDebounceMs = kDebounceMs;

// Gate relay pulse handoff (MQTT callback -> loop) plus the live pulse state.
// loop() owns the relay pin; the callback only stages a request under stateMux.
volatile bool relayPulsePending = false;
volatile unsigned long pendingRelayPulseMs = kRelayPulseDefaultMs;
bool relayClosed = false;
unsigned long relayClosedAtMs = 0;
unsigned long relayPulseMs = kRelayPulseDefaultMs;

void writeRelay(bool closed) {
  digitalWrite(kRelayPin, closed == kRelayActiveHigh ? HIGH : LOW);
}

unsigned long clampUL(unsigned long value, unsigned long lo, unsigned long hi) {
  return value < lo ? lo : (value > hi ? hi : value);
}

// Guards the OTA handoff from the MQTT callback (AsyncTCP task) to loop()
// (main task).
portMUX_TYPE stateMux = portMUX_INITIALIZER_UNLOCKED;

// Set from the MQTT message callback, actually performed from loop(). The
// callback runs on AsyncTCP's own task with a small stack — running the
// blocking HTTP download + flash write there overflows it and crash-loops
// the device on every reconnect (it just keeps re-receiving the retained
// manifest). Deferring to loop() runs it on the main task's full-size stack.
// Fixed buffers (not String) so the handoff copies bytes under stateMux
// instead of sharing a heap-backed String across tasks, where a second
// manifest could realloc the buffer out from under the reader.
volatile bool otaPending = false;
char otaUrl[192] = {0};
char otaMd5[40] = {0};

// Publishes the retained "online" liveness status (with firmware version and
// IP). Called on connect and refreshed periodically as a heartbeat, so the
// backend can tell a live device from one that silently dropped off WiFi.
void publishStatusOnline() {
  char payload[96];
  const int n = snprintf(payload, sizeof(payload),
                         "{\"online\":true,\"version\":\"%s\",\"ip\":\"%s\"}",
                         kFirmwareVersion, WiFi.localIP().toString().c_str());
  if (n > 0) {
    mqttClient.publish(kStatusTopic, 1, true, payload, static_cast<size_t>(n));
  }
  lastHeartbeatMs = millis();
}

void connectMqtt() {
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCredentials(MQTT_USERNAME, MQTT_PASSWORD);
  mqttClient.setClientId(mqttClientId.c_str());
  // Last Will: if we drop without a clean disconnect, the broker publishes this
  // retained "offline" for us so the backend notices within the keepalive window.
  mqttClient.setWill(kStatusTopic, 1, true, kStatusOfflinePayload);
  mqttClient.connect();
}

// Compares dotted "a.b.c" versions. Returns true only if candidate is strictly
// newer than current, so a stale/rolled-back manifest can't downgrade us.
bool parseSemver(const char* v, int parts[3]) {
  parts[0] = parts[1] = parts[2] = 0;
  return sscanf(v, "%d.%d.%d", &parts[0], &parts[1], &parts[2]) == 3;
}

bool isNewerVersion(const char* candidate, const char* current) {
  int c[3], r[3];
  if (!parseSemver(candidate, c) || !parseSemver(current, r)) {
    return false;
  }
  for (int i = 0; i < 3; ++i) {
    if (c[i] != r[i]) {
      return c[i] > r[i];
    }
  }
  return false;
}

// Downloads the new app image over plain HTTP and writes it to the inactive
// OTA partition. No HTTPS yet, so this trusts whatever the manifest's URL
// points to — fine for now since it's our own VPS, but tighten this with
// HTTPS + the broker already being password-protected before treating it as
// hardened against tampering.
void performOta(const char* url, const char* expectedMd5) {
  Serial.printf("OTA: downloading %s\n", url);

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

  if (strlen(expectedMd5) > 0) {
    Update.setMD5(expectedMd5);
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
  JsonDocument doc;
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

  // Require an integrity hash — without HTTPS/signatures the MD5 is the only
  // check we have, so refuse rather than flash an unverifiable image.
  if (strlen(md5) == 0) {
    Serial.println("OTA: manifest has no md5 — refusing update");
    return;
  }

  if (!isNewerVersion(version, kFirmwareVersion)) {
    Serial.printf("OTA: %s is not newer than %s — ignoring\n", version, kFirmwareVersion);
    return;
  }

  Serial.printf("OTA: new firmware available (%s -> %s)\n", kFirmwareVersion, version);
  portENTER_CRITICAL(&stateMux);
  strlcpy(otaUrl, url, sizeof(otaUrl));
  strlcpy(otaMd5, md5, sizeof(otaMd5));
  otaPending = true;
  portEXIT_CRITICAL(&stateMux);
}

// Parses a retained config push and stages it for loop() to apply. Values are
// clamped; the re-ping interval is also kept under 6.5s so it stays below the
// receiver's alert window (the backend enforces the exact relationship).
void onTransmitterConfig(char* payload, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) {
    Serial.println("config: parse failed");
    return;
  }

  const unsigned long ping = clampUL(doc["pingIntervalMs"] | kPingIntervalMs, 500, 6500);
  const unsigned long debounce = clampUL(doc["debounceMs"] | kDebounceMs, 0, 2000);

  portENTER_CRITICAL(&stateMux);
  pendingPingIntervalMs = ping;
  pendingDebounceMs = debounce;
  configPending = true;
  portEXIT_CRITICAL(&stateMux);
  Serial.printf("config: ping=%lu debounce=%lu\n", ping, debounce);
}

// One-shot commands. "pulse": close the gate relay briefly — the gate motor
// board cycles open/stop/close on its own with each trigger.
void onTransmitterCommand(char* payload, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) {
    Serial.println("command: parse failed");
    return;
  }

  const char* action = doc["action"] | "";
  if (strcmp(action, "pulse") != 0) {
    return;
  }

  const unsigned long pulse = clampUL(doc["pulseMs"] | kRelayPulseDefaultMs, 100, 5000);
  portENTER_CRITICAL(&stateMux);
  pendingRelayPulseMs = pulse;
  relayPulsePending = true;
  portEXIT_CRITICAL(&stateMux);
  Serial.printf("command: gate relay pulse %lums\n", pulse);
}

void onMqttMessage(char* topic,
                    char* payload,
                    AsyncMqttClientMessageProperties /*properties*/,
                    size_t len,
                    size_t /*index*/,
                    size_t /*total*/) {
  if (strcmp(topic, kFirmwareTopic) == 0) {
    onFirmwareManifest(payload, len);
  } else if (strcmp(topic, kConfigTopic) == 0) {
    onTransmitterConfig(payload, len);
  } else if (strcmp(topic, kCommandTopic) == 0) {
    onTransmitterCommand(payload, len);
  }
}

void onMqttConnect(bool /*sessionPresent*/) {
  Serial.println("MQTT connected");
  mqttConnected = true;
  mqttClient.subscribe(kFirmwareTopic, 1);
  mqttClient.subscribe(kConfigTopic, 1);
  mqttClient.subscribe(kCommandTopic, 1);
  publishStatusOnline();  // announce we're alive (clears any retained "offline")
}

void onMqttDisconnect(AsyncMqttClientDisconnectReason reason) {
  Serial.printf("MQTT disconnected (%u)\n", static_cast<unsigned>(reason));
  mqttConnected = false;

  if (WiFi.isConnected()) {
    connectMqtt();
  }
}

bool publishTrigger(const char* event) {
  JsonDocument doc;
  doc["event"] = event;

  char payload[32];
  const size_t length = serializeJson(doc, payload, sizeof(payload));

  if (!mqttConnected) {
    Serial.printf("MQTT offline — skipped trigger event=%s\n", event);
    return false;
  }

  // publish() returns the packet id, or 0 if the client couldn't even enqueue
  // the message. Treat 0 as a failure so the caller retries next tick instead
  // of falsely marking the trigger as sent — the "never lose the first on"
  // guarantee in loop() depends on this actually reflecting the enqueue.
  const uint16_t packetId = mqttClient.publish(kTriggerTopic, 1, false, payload, length);
  if (packetId == 0) {
    Serial.printf("MQTT publish failed to enqueue — event=%s\n", event);
    return false;
  }

  Serial.printf("Published trigger event=%s (packetId=%u)\n", event, packetId);
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

  delay(debounceMs);
  return sensorActive();
}

// WiFi comes up in three tiers: (1) a network the client saved through the
// portal takes priority; (2) otherwise a brand-new unit falls back to the
// built-in default from secrets.h so it connects with zero setup; (3) if
// neither connects, WiFiManager starts a "GateSensor-Transmitter-Setup" access
// point with a captive portal where you pick the network and enter the
// password from a phone/laptop browser. Holding the BOOT button down through
// power-on/reset forces the portal back open even if a network is already
// saved, as the way to reconfigure WiFi later without re-flashing.
void connectWiFiBlocking() {
  WiFiManager wm;
  wm.setConfigPortalTimeout(180);
  wm.setConnectTimeout(20);

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

  // A fresh (or freshly-reset) unit has no saved network — try the built-in
  // default so it connects with zero setup. Once the client configures a
  // network through the portal, WiFiManager saves it and getWiFiIsSaved()
  // becomes true, so this default block is skipped and their network wins.
  if (!wm.getWiFiIsSaved()) {
    Serial.printf("No saved WiFi — trying built-in default \"%s\"\n", WIFI_DEFAULT_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_DEFAULT_SSID, WIFI_DEFAULT_PASS);
    const unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
      delay(250);
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("WiFi connected (built-in default), IP: ");
      Serial.println(WiFi.localIP());
      return;
    }
    Serial.println("Default network unavailable — opening setup portal");
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
  // Drive the relay pin to its open (inactive) level BEFORE switching it to
  // OUTPUT so the gate can't get a phantom trigger during boot.
  writeRelay(false);
  pinMode(kRelayPin, OUTPUT);
  writeRelay(false);

  // Build a unique client id from the chip MAC before any connect can fire
  // (onWiFiEvent's GOT_IP calls connectMqtt() during connectWiFiBlocking()).
  char idBuf[40];
  snprintf(idBuf, sizeof(idBuf), "%s%012llX", kMqttClientIdPrefix, ESP.getEfuseMac());
  mqttClientId = idBuf;
  Serial.printf("[boot] mqttClientId=%s\n", mqttClientId.c_str());

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
  // Copy any pending OTA job out under the lock, then run it on this task.
  bool doOta = false;
  char localUrl[192];
  char localMd5[40];
  portENTER_CRITICAL(&stateMux);
  if (otaPending) {
    otaPending = false;
    strlcpy(localUrl, otaUrl, sizeof(localUrl));
    strlcpy(localMd5, otaMd5, sizeof(localMd5));
    doOta = true;
  }
  portEXIT_CRITICAL(&stateMux);
  if (doOta) {
    performOta(localUrl, localMd5);
    // Falls through to normal operation if the OTA attempt failed/returned —
    // ESP.restart() inside performOta() means we never get here on success.
  }

  // Liveness heartbeat: refresh the retained "online" status so the backend can
  // distinguish a live device from one whose heartbeats simply stopped.
  if (mqttConnected && millis() - lastHeartbeatMs >= kHeartbeatMs) {
    publishStatusOnline();
  }

  // Apply any new config handed over from the MQTT callback.
  portENTER_CRITICAL(&stateMux);
  if (configPending) {
    configPending = false;
    pingIntervalMs = pendingPingIntervalMs;
    debounceMs = pendingDebounceMs;
  }
  portEXIT_CRITICAL(&stateMux);

  const unsigned long now = millis();

  // Gate relay: start a requested pulse, and release it once the pulse
  // duration has elapsed. A command that lands mid-pulse restarts the timer
  // rather than double-triggering.
  bool startPulse = false;
  portENTER_CRITICAL(&stateMux);
  if (relayPulsePending) {
    relayPulsePending = false;
    relayPulseMs = pendingRelayPulseMs;
    startPulse = true;
  }
  portEXIT_CRITICAL(&stateMux);
  if (startPulse) {
    writeRelay(true);
    relayClosed = true;
    relayClosedAtMs = now;
    Serial.printf("gate relay closed for %lums\n", relayPulseMs);
  } else if (relayClosed && now - relayClosedAtMs >= relayPulseMs) {
    writeRelay(false);
    relayClosed = false;
    Serial.println("gate relay released");
  }

  switch (state) {
    case TransmitterState::Idle:
      // If MQTT happens to be mid-reconnect right when this fires, don't just
      // drop it — keep retrying every loop tick (~75ms) while still
      // triggered, so the very first "on" of a block is never silently lost.
      if (debouncedHigh() && publishTrigger("on")) {
        state = TransmitterState::Active;
        lastPingMs = now;
      }
      break;

    case TransmitterState::Active:
      if (sensorActive()) {
        // Same retry logic: only push the deadline out once the ping
        // actually lands, so a dropped one is retried next tick instead of
        // waiting a full kPingIntervalMs longer.
        if (now - lastPingMs >= pingIntervalMs && publishTrigger("on")) {
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
