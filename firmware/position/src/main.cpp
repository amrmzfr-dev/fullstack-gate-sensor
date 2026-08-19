#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <AsyncMqttClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <Wire.h>

#include "secrets.h"

namespace {

// AS5600 magnetic rotary encoder over I2C. DIR is tied to GND (clockwise
// rotation = increasing raw angle). Default pins below are free on both the
// transmitter and receiver boards today — change if your wiring differs.
constexpr uint8_t kSdaPin = 21;
constexpr uint8_t kSclPin = 22;
constexpr uint8_t kAs5600Addr = 0x36;
constexpr uint8_t kRegStatus = 0x0B;     // MD/ML/MH magnet-detect bits
constexpr uint8_t kRegRawAngle = 0x0C;   // 12-bit raw angle, big-endian, 2 bytes
constexpr uint8_t kStatusMdBit = 0x20;   // magnet detected
constexpr uint8_t kStatusMlBit = 0x10;   // magnet too weak
constexpr uint8_t kStatusMhBit = 0x08;   // magnet too strong

constexpr uint8_t kConfigResetPin = 0;  // BOOT button — hold at startup to force the WiFi setup portal

constexpr char kMqttClientIdPrefix[] = "gate-position-";
// Liveness: retained online/offline status the backend watches, same shape as
// the transmitter/receiver. The broker publishes kStatusOfflinePayload as our
// Last Will if we drop uncleanly; we publish "online" on connect and refresh
// it on a timer.
constexpr char kStatusTopic[] = "gate/position/status";
constexpr char kStatusOfflinePayload[] = "{\"online\":false}";
constexpr unsigned long kHeartbeatMs = 30000;
// Bump this with every release that gets copied into backend/wwwroot/firmware/position/.
constexpr char kFirmwareVersion[] = "1.0.0";
constexpr char kFirmwareTopic[] = "firmware/position/latest";
// Retained calibration + poll-rate config the backend pushes.
constexpr char kConfigTopic[] = "gate/position/config";
// Live percent-open stream, published every pollIntervalMs. Not retained —
// this is a continuous stream, not a one-shot command, so a fresh subscriber
// just waits for the next tick instead of replaying a stale value.
constexpr char kTelemetryTopic[] = "gate/position/telemetry";
constexpr unsigned long kPollIntervalMsDefault = 250;
constexpr unsigned long kWifiResetHoldMs = 3000;
// Connectivity watchdog: reconnection is normally event-driven (GOT_IP ->
// connectMqtt, onMqttDisconnect -> connectMqtt), but a connect attempt that
// fails without firing its callback dead-ends the chain and the device sits
// powered-but-silent forever. The watchdog kicks a reconnect periodically and,
// as a last resort, reboots — the remote equivalent of a manual reset.
constexpr unsigned long kMqttRetryMs = 30000;
constexpr unsigned long kOfflineRebootMs = 300000;  // 5 min

// Wrap-unwrap: a raw-angle delta bigger than half a turn between polls is
// treated as having wrapped through the 0/4095 boundary rather than an actual
// half-turn jump. Safe as long as the wheel turns less than half a revolution
// per poll (>2 rev/s at the default 250ms poll) — nowhere near real gate speed.
constexpr int kWrapThresholdTicks = 2048;
constexpr int kTicksPerTurn = 4096;
// Anything bigger than this in one poll is almost certainly noise (a loose
// magnet, EMI) rather than real gate motion — still comfortably under the
// wrap-ambiguity ceiling above.
constexpr int kImplausibleJumpTicks = 800;
// How close the raw angle and the tracked cumulative position both need to be
// to a calibrated reference before we trust it enough to snap onto it exactly
// (self-correcting drift, and recovering from a boot-time "assume closed"
// guess that turned out wrong once the gate next reaches a hard limit).
constexpr int kSnapAngleToleranceTicks = 20;
constexpr int32_t kSnapCumulativeToleranceTicks = 80;

// Runtime calibration + poll rate, pushed retained from the backend over
// gate/position/config and applied live. rawClosed/rawOpen are AS5600 raw
// single-turn readings (0-4095) captured at each limit; openTicksSpan is the
// signed cumulative-tick distance from closed to open (its sign captures
// whichever physical direction "opening" turned out to be, so the firmware
// never needs to know which way the wheel turns). openTicksSpan == 0 means
// "not calibrated yet".
struct PositionConfig {
  int rawClosed;
  int rawOpen;
  int32_t openTicksSpan;
  unsigned long pollIntervalMs;
};
PositionConfig cfg = {-1, -1, 0, kPollIntervalMsDefault};  // loop-owned
PositionConfig pendingCfg = cfg;                            // guarded by stateMux
volatile bool configPending = false;

AsyncMqttClient mqttClient;
bool mqttConnected = false;

// Unique per-device client id, built once from the chip MAC in setup().
String mqttClientId;
// Last time we published a liveness heartbeat (main task only).
unsigned long lastHeartbeatMs = 0;
// Watchdog bookkeeping (main task only).
unsigned long lastMqttOnlineMs = 0;
unsigned long lastMqttAttemptMs = 0;

// Guards the cross-task handoffs below. The MQTT callbacks run on AsyncTCP's
// own task; the fields they touch are consumed on the main loop() task, so
// every shared write/read is wrapped in this spinlock.
portMUX_TYPE stateMux = portMUX_INITIALIZER_UNLOCKED;

// Set from the MQTT message callback, actually performed from loop(). See
// firmware/transmitter/src/main.cpp for why this handoff exists (the AsyncTCP
// task's stack is too small for the blocking HTTP download + flash write).
volatile bool otaPending = false;
char otaUrl[192] = {0};
char otaMd5[40] = {0};

// AS5600 polling state — read/written only from loop().
unsigned long lastPollMs = 0;
bool firstReadDone = false;
int previousRawAngle = 0;
int32_t cumulativeTicks = 0;

unsigned long clampUL(unsigned long value, unsigned long lo, unsigned long hi) {
  return value < lo ? lo : (value > hi ? hi : value);
}

// Shortest distance between two raw angles around the 0/4095 circle.
int circularDistance(int a, int b) {
  int d = abs(a - b);
  return d > kTicksPerTurn / 2 ? kTicksPerTurn - d : d;
}

bool readAs5600Register16(uint8_t reg, uint16_t& value) {
  Wire.beginTransmission(kAs5600Addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }
  if (Wire.requestFrom(static_cast<int>(kAs5600Addr), 2) != 2) {
    return false;
  }
  const uint8_t hi = Wire.read();
  const uint8_t lo = Wire.read();
  value = (static_cast<uint16_t>(hi & 0x0F) << 8) | lo;
  return true;
}

bool readRawAngle(int& angle) {
  uint16_t raw = 0;
  if (!readAs5600Register16(kRegRawAngle, raw)) {
    return false;
  }
  angle = static_cast<int>(raw);
  return true;
}

// Magnet-detect status straight from the chip — a far more reliable "loose
// magnet or wiring issue" signal than anything derived from the angle alone.
bool readMagnetOk() {
  Wire.beginTransmission(kAs5600Addr);
  Wire.write(kRegStatus);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }
  if (Wire.requestFrom(static_cast<int>(kAs5600Addr), 1) != 1) {
    return false;
  }
  const uint8_t status = Wire.read();
  return (status & kStatusMdBit) != 0 && (status & kStatusMlBit) == 0 && (status & kStatusMhBit) == 0;
}

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

// See firmware/transmitter/src/main.cpp's performOta for the same caveat:
// plain HTTP, no signature check beyond the MD5 integrity hash.
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

// Parses a retained calibration/poll-rate push and stages it for loop() to
// apply. openTicksSpan of 0 means "not calibrated" — see the PositionConfig
// doc comment above.
void onPositionConfig(char* payload, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) {
    Serial.println("config: parse failed");
    return;
  }

  PositionConfig c;
  c.rawClosed = doc["rawClosed"] | -1;
  c.rawOpen = doc["rawOpen"] | -1;
  c.openTicksSpan = doc["openTicksSpan"] | 0;
  c.pollIntervalMs = clampUL(doc["pollIntervalMs"] | kPollIntervalMsDefault, 50, 5000);

  portENTER_CRITICAL(&stateMux);
  pendingCfg = c;
  configPending = true;
  portEXIT_CRITICAL(&stateMux);
  Serial.printf("config: rawClosed=%d rawOpen=%d openTicksSpan=%ld pollIntervalMs=%lu\n",
                c.rawClosed, c.rawOpen, static_cast<long>(c.openTicksSpan), c.pollIntervalMs);
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
    onPositionConfig(payload, len);
  }
}

void onMqttConnect(bool /*sessionPresent*/) {
  Serial.println("MQTT connected");
  mqttConnected = true;
  mqttClient.subscribe(kFirmwareTopic, 1);
  mqttClient.subscribe(kConfigTopic, 1);
  publishStatusOnline();  // announce we're alive (clears any retained "offline")
}

void onMqttDisconnect(AsyncMqttClientDisconnectReason reason) {
  Serial.printf("MQTT disconnected (%u)\n", static_cast<unsigned>(reason));
  mqttConnected = false;

  if (WiFi.isConnected()) {
    connectMqtt();
  }
}

// WiFi comes up in three tiers: (1) a network the client saved through the
// portal, (2) the built-in default from secrets.h for a brand-new unit, and
// (3) the WiFiManager captive portal if neither connects. See
// firmware/transmitter/src/main.cpp for the shared rationale.
void connectWiFiBlocking() {
  WiFiManager wm;
  wm.setConfigPortalTimeout(180);
  wm.setConnectTimeout(20);

  // Require a deliberate 3s hold before wiping saved WiFi credentials.
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

  Serial.println("Connecting to WiFi (or starting \"GateSensor-Position-Setup\" portal)...");
  if (!wm.autoConnect("GateSensor-Position-Setup")) {
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

// Reads the AS5600, updates the wrap-unwrapped cumulative position, and
// publishes telemetry. Called from loop() every cfg.pollIntervalMs.
void pollAndPublish() {
  int rawAngle = 0;
  if (!readRawAngle(rawAngle)) {
    Serial.println("AS5600: I2C read failed — check wiring");
    return;
  }
  const bool magnetOk = readMagnetOk();
  if (!magnetOk) {
    Serial.println("AS5600: magnet not detected or out of range — check magnet/wiring");
  }

  const bool hasCalibration = cfg.openTicksSpan != 0;

  if (!firstReadDone) {
    // Assume the gate is at its closed position on boot (reboots are rare and
    // gates sit closed most of the time) and anchor the cumulative counter
    // there. If that guess is wrong, the snap-to-reference correction below
    // self-heals the next time the gate reaches either hard limit.
    previousRawAngle = rawAngle;
    cumulativeTicks = 0;
    firstReadDone = true;
  } else {
    int delta = rawAngle - previousRawAngle;
    if (delta > kWrapThresholdTicks) {
      delta -= kTicksPerTurn;
    } else if (delta < -kWrapThresholdTicks) {
      delta += kTicksPerTurn;
    }

    if (abs(delta) > kImplausibleJumpTicks) {
      Serial.printf("AS5600: reading jumped %d ticks in one poll — noisy signal, loose magnet, "
                    "or wiring issue?\n", delta);
    }

    cumulativeTicks += delta;
    previousRawAngle = rawAngle;

    if (hasCalibration) {
      if (circularDistance(rawAngle, cfg.rawClosed) <= kSnapAngleToleranceTicks
          && abs(cumulativeTicks - 0) <= kSnapCumulativeToleranceTicks) {
        cumulativeTicks = 0;
      } else if (circularDistance(rawAngle, cfg.rawOpen) <= kSnapAngleToleranceTicks
          && abs(cumulativeTicks - cfg.openTicksSpan) <= kSnapCumulativeToleranceTicks) {
        cumulativeTicks = cfg.openTicksSpan;
      }
    }
  }

  int percentOpen = -1;
  if (hasCalibration) {
    const double raw = static_cast<double>(cumulativeTicks) * 100.0 / static_cast<double>(cfg.openTicksSpan);
    percentOpen = static_cast<int>(lround(raw));
    percentOpen = percentOpen < 0 ? 0 : (percentOpen > 100 ? 100 : percentOpen);
  }

  if (!mqttConnected) {
    return;
  }

  JsonDocument doc;
  doc["rawAngle"] = rawAngle;
  doc["cumulativeTicks"] = cumulativeTicks;
  doc["percentOpen"] = percentOpen;
  doc["positionKnown"] = hasCalibration;
  doc["magnetOk"] = magnetOk;

  char payload[128];
  const size_t length = serializeJson(doc, payload, sizeof(payload));
  mqttClient.publish(kTelemetryTopic, 1, false, payload, length);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Wire.begin(kSdaPin, kSclPin);
  pinMode(kConfigResetPin, INPUT_PULLUP);

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
  // connectMqtt() is NOT called here — see transmitter/src/main.cpp for why.
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

  // Connectivity watchdog (see kMqttRetryMs above for why events alone
  // aren't trusted).
  {
    const unsigned long wdNow = millis();
    if (mqttConnected) {
      lastMqttOnlineMs = wdNow;
    } else {
      if (WiFi.isConnected() && wdNow - lastMqttAttemptMs >= kMqttRetryMs) {
        lastMqttAttemptMs = wdNow;
        Serial.println("watchdog: MQTT down — forcing reconnect");
        connectMqtt();
      }
      if (wdNow - lastMqttOnlineMs >= kOfflineRebootMs) {
        Serial.println("watchdog: offline 5 min — restarting");
        delay(100);
        ESP.restart();
      }
    }
  }

  // Apply any new calibration/poll-rate config handed over from the MQTT callback.
  portENTER_CRITICAL(&stateMux);
  if (configPending) {
    configPending = false;
    cfg = pendingCfg;
  }
  portEXIT_CRITICAL(&stateMux);

  const unsigned long now = millis();
  if (now - lastPollMs >= cfg.pollIntervalMs) {
    lastPollMs = now;
    pollAndPublish();
  }

  delay(10);
}
