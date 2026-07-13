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
// Prefix only — the actual client id gets the chip's MAC appended (see setup)
// so two units (or an impostor) can't collide on one id and kick each other
// off the broker ("session taken over").
constexpr char kMqttClientIdPrefix[] = "gate-receiver-";
// Liveness: retained online/offline state the backend watches. The broker
// publishes kStatusOfflinePayload on our behalf (Last Will) if we drop without
// a clean disconnect; we publish "online" on connect and refresh it on a timer.
constexpr char kStatusTopic[] = "gate/receiver/status";
constexpr char kStatusOfflinePayload[] = "{\"online\":false}";
constexpr unsigned long kHeartbeatMs = 30000;
// Bump this with every release that gets copied into backend/wwwroot/firmware/receiver/.
constexpr char kFirmwareVersion[] = "1.6.1";
constexpr char kFirmwareTopic[] = "firmware/receiver/latest";
// Retained beep settings the backend pushes, and one-shot commands (e.g. the
// dashboard's acknowledge/silence button, or a "test" preview after a save).
constexpr char kConfigTopic[] = "gate/receiver/config";
constexpr char kCommandTopic[] = "gate/receiver/command";
constexpr unsigned long kDefaultCooldownMs = 30000;
constexpr unsigned long kTestDurationMs = 4000;  // how long a "test" plays the pattern
// Defaults below double as the fallback config for an unconfigured unit.
constexpr unsigned long kBeepOnMs = 1000;    // each beep lasts 1s
constexpr unsigned long kBeepGapMs = 1000;   // 1s gap between beeps within a cycle
constexpr unsigned long kPauseMs = 2000;     // 2s pause after a cycle before looping
constexpr uint8_t kBeepsPerCycle = 5;
constexpr unsigned long kWifiResetHoldMs = 3000;
// Connectivity watchdog: reconnection is normally event-driven (GOT_IP ->
// connectMqtt, onMqttDisconnect -> connectMqtt), but a connect attempt that
// fails without firing its callback dead-ends the chain and the device sits
// powered-but-silent forever. The watchdog kicks a reconnect periodically and,
// as a last resort, reboots — the remote equivalent of a manual reset.
constexpr unsigned long kMqttRetryMs = 30000;
constexpr unsigned long kOfflineRebootMs = 300000;  // 5 min
// Every "on" ping guarantees at least this long of alerting, however brief
// the trigger was — "off" is intentionally ignored for buzzer control (the
// transmitter only sends it for the dashboard log). While the sensor stays
// blocked, the transmitter re-pings before this deadline, pushing it out —
// that's how "still there" keeps the alarm going past the 7s minimum.
constexpr unsigned long kAlertWindowMs = 7000;

enum class BuzzerPhase { kOn, kGap, kPause };

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

// Buzzer "on" ping handed from the MQTT callback to loop(). loop() owns the
// whole pulsing state machine, so nothing below is ever touched from two tasks.
// The alert deadline is computed in loop() from the live config when the ping
// is consumed, so the callback only has to raise this flag.
volatile bool alertPending = false;

// Runtime beep configuration, pushed retained from the backend over
// gate/receiver/config and applied live. Defaults match the old compiled-in
// constants, so an unconfigured unit behaves exactly as it did before.
struct BeepConfig {
  unsigned long beepOnMs;
  unsigned long beepGapMs;
  unsigned long pauseMs;
  unsigned long alertWindowMs;
  uint8_t beepsPerCycle;
};
BeepConfig cfg = {kBeepOnMs, kBeepGapMs, kPauseMs, kAlertWindowMs, kBeepsPerCycle};  // loop-owned
BeepConfig pendingCfg = cfg;        // guarded by stateMux
volatile bool configPending = false;

// Acknowledge/cooldown: a "silence" command silences the buzzer now and makes
// loop() ignore incoming alerts until the cooldown expires, so the client can
// quiet a known alert for a configurable few seconds.
volatile bool cooldownPending = false;
volatile bool testPending = false;  // play the current pattern briefly (preview after a save)
volatile unsigned long pendingCooldownMs = 0;
unsigned long cooldownUntilMs = 0;  // loop-owned; alerts ignored while now < this

// Pulsing state — kept separate from "is the alert logically active" so the
// buzzer runs its 3-beeps-then-pause pattern instead of holding one continuous tone.
// Only ever read/written from loop().
bool buzzerActive = false;
bool buzzerPinOn = false;
BuzzerPhase buzzerPhase = BuzzerPhase::kOn;
uint8_t beepIndex = 0;
unsigned long lastToggleMs = 0;
unsigned long alertDeadlineMs = 0;

unsigned long clampUL(unsigned long value, unsigned long lo, unsigned long hi) {
  return value < lo ? lo : (value > hi ? hi : value);
}

void setBuzzerPin(bool on) {
  buzzerPinOn = on;
  digitalWrite(kBuzzerPin, on ? LOW : HIGH);  // low-level-trigger module
  Serial.printf("[buzzer] pin=%s beepIndex=%u/%u\n", on ? "ON" : "OFF", beepIndex, cfg.beepsPerCycle);
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

// Parses a retained config push and hands it to loop() to apply. Every field
// is clamped to a sane range so a bad value can't wedge the buzzer.
void onReceiverConfig(char* payload, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) {
    Serial.println("config: parse failed");
    return;
  }

  BeepConfig c;
  c.beepOnMs = clampUL(doc["beepOnMs"] | kBeepOnMs, 50, 60000);
  c.beepGapMs = clampUL(doc["beepGapMs"] | kBeepGapMs, 0, 60000);
  c.pauseMs = clampUL(doc["pauseMs"] | kPauseMs, 0, 60000);
  c.alertWindowMs = clampUL(doc["alertWindowMs"] | kAlertWindowMs, 1000, 600000);
  c.beepsPerCycle =
      static_cast<uint8_t>(clampUL(doc["beepsPerCycle"] | static_cast<unsigned long>(kBeepsPerCycle), 1, 50));

  portENTER_CRITICAL(&stateMux);
  pendingCfg = c;
  configPending = true;
  portEXIT_CRITICAL(&stateMux);
  Serial.printf("config: on=%lu gap=%lu pause=%lu window=%lu beeps=%u\n",
                c.beepOnMs, c.beepGapMs, c.pauseMs, c.alertWindowMs, c.beepsPerCycle);
}

// Handles one-shot commands: "silence" (acknowledge) quiets the buzzer and
// starts a cooldown; "test" briefly plays the current pattern so the client can
// hear a setting right after saving it.
void onReceiverCommand(char* payload, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) {
    return;
  }

  const char* action = doc["action"] | "";
  if (strcmp(action, "silence") == 0) {
    const unsigned long cd = clampUL(doc["cooldownMs"] | kDefaultCooldownMs, 0, 3600000);
    portENTER_CRITICAL(&stateMux);
    pendingCooldownMs = cd;
    cooldownPending = true;
    portEXIT_CRITICAL(&stateMux);
    Serial.printf("command: silence (cooldown=%lu ms)\n", cd);
  } else if (strcmp(action, "test") == 0) {
    portENTER_CRITICAL(&stateMux);
    testPending = true;
    portEXIT_CRITICAL(&stateMux);
    Serial.println("command: test buzzer");
  }
}

void onMqttConnect(bool /*sessionPresent*/) {
  Serial.println("MQTT connected");
  mqttConnected = true;
  mqttClient.subscribe(kBuzzerTopic, 1);
  mqttClient.subscribe(kFirmwareTopic, 1);
  mqttClient.subscribe(kConfigTopic, 1);
  mqttClient.subscribe(kCommandTopic, 1);
  Serial.printf("Subscribed to %s, %s, %s, %s (QoS 1)\n",
                kBuzzerTopic, kFirmwareTopic, kConfigTopic, kCommandTopic);
  publishStatusOnline();  // announce we're alive (clears any retained "offline")
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

  if (strcmp(topic, kConfigTopic) == 0) {
    onReceiverConfig(payload, len);
    return;
  }

  if (strcmp(topic, kCommandTopic) == 0) {
    onReceiverCommand(payload, len);
    return;
  }

  if (strcmp(topic, kBuzzerTopic) != 0) {
    return;
  }

  // gate/buzzer is published retained by the backend, so on every (re)connect
  // the broker replays the last retained command. If that command was an "on"
  // — e.g. the transmitter lost power mid-block and never sent "off" — acting
  // on it would make the receiver false-alarm for a full window on every
  // reboot/WiFi flap. Only act on live messages; skip retained replays
  // entirely (no buzz, and no stale ack referencing an old eventId).
  if (properties.retain) {
    Serial.println("Ignoring retained buzzer message on (re)connect");
    return;
  }

  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, payload, len);
  if (error) {
    Serial.printf("Failed to parse buzzer payload: %s\n", error.c_str());
    return;
  }

  const bool buzzerOn = doc["on"] | false;
  const char* eventId = doc["eventId"] | "";

  if (buzzerOn) {
    // Hand the ping over to loop(), which owns the buzzer state machine, the
    // pin, and the live config (it computes the deadline from cfg.alertWindowMs
    // when it consumes this). "off" is intentionally ignored — see the
    // kAlertWindowMs comment above.
    portENTER_CRITICAL(&stateMux);
    alertPending = true;
    portEXIT_CRITICAL(&stateMux);
  }
  Serial.printf("Buzzer %s (eventId=%s)\n", buzzerOn ? "ON" : "OFF", eventId);

  JsonDocument ackDoc;
  ackDoc["on"] = buzzerOn;
  ackDoc["eventId"] = eventId;

  char ackPayload[96];
  const size_t ackLength = serializeJson(ackDoc, ackPayload, sizeof(ackPayload));
  mqttClient.publish(kAckTopic, 1, false, ackPayload, ackLength);
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

  // Apply any new beep config handed over from the MQTT callback.
  portENTER_CRITICAL(&stateMux);
  const bool applyCfg = configPending;
  if (applyCfg) {
    configPending = false;
    cfg = pendingCfg;
  }
  portEXIT_CRITICAL(&stateMux);
  if (applyCfg) {
    Serial.println("Applied new beep config");
  }

  // Apply an acknowledge/silence command: quiet the buzzer now and start the
  // cooldown window during which alerts are ignored.
  portENTER_CRITICAL(&stateMux);
  const bool applyCooldown = cooldownPending;
  const unsigned long cooldownMs = pendingCooldownMs;
  if (applyCooldown) {
    cooldownPending = false;
    alertPending = false;  // drop any queued alert too
  }
  portEXIT_CRITICAL(&stateMux);
  if (applyCooldown) {
    cooldownUntilMs = millis() + cooldownMs;
    buzzerActive = false;
    setBuzzerPin(false);
    Serial.printf("Acknowledged — silenced, cooling down for %lu ms\n", cooldownMs);
  }

  // Consume a "test" command: play the current pattern for a few seconds so the
  // client can preview it. Bypasses cooldown (they explicitly asked to hear it),
  // and only ever extends an in-flight alert's deadline, never shortens it.
  portENTER_CRITICAL(&stateMux);
  const bool startTest = testPending;
  if (startTest) {
    testPending = false;
  }
  portEXIT_CRITICAL(&stateMux);
  if (startTest) {
    const unsigned long testDeadline = millis() + kTestDurationMs;
    if (!buzzerActive) {
      buzzerActive = true;
      beepIndex = 0;
      buzzerPhase = BuzzerPhase::kOn;
      lastToggleMs = millis();
      setBuzzerPin(true);
      alertDeadlineMs = testDeadline;
      Serial.println("Testing buzzer pattern");
    } else if (static_cast<int32_t>(testDeadline - alertDeadlineMs) > 0) {
      alertDeadlineMs = testDeadline;  // already buzzing — just make sure it lasts long enough to hear
    }
  }

  // Consume any buzzer "on" ping handed over from the MQTT callback.
  portENTER_CRITICAL(&stateMux);
  const bool startAlert = alertPending;
  if (startAlert) {
    alertPending = false;
  }
  portEXIT_CRITICAL(&stateMux);
  if (startAlert) {
    // Ignore alerts while cooling down from an acknowledge.
    if (static_cast<int32_t>(millis() - cooldownUntilMs) < 0) {
      Serial.println("In cooldown — ignoring alert ping");
    } else {
      alertDeadlineMs = millis() + cfg.alertWindowMs;  // (re)start or extend the window
      if (!buzzerActive) {
        // Fresh trigger from idle — start the beep pattern from the top. If
        // already alerting, leave the in-flight beep/gap/pause cycle alone so a
        // refresh ping doesn't audibly restart it.
        buzzerActive = true;
        beepIndex = 0;
        buzzerPhase = BuzzerPhase::kOn;
        lastToggleMs = millis();
        setBuzzerPin(true);
      }
    }
  }

  // Overflow-safe: the signed difference stays correct across the ~49-day
  // millis() wrap, where an absolute `millis() >= alertDeadlineMs` compare
  // would misfire (cutting an active alarm short around the rollover).
  if (buzzerActive && static_cast<int32_t>(millis() - alertDeadlineMs) >= 0) {
    Serial.println("Safety timeout — no \"off\" received in time, silencing buzzer");
    buzzerActive = false;
    setBuzzerPin(false);
  }

  if (buzzerActive) {
    const unsigned long elapsed = millis() - lastToggleMs;

    switch (buzzerPhase) {
      case BuzzerPhase::kOn:
        if (elapsed >= cfg.beepOnMs) {
          setBuzzerPin(false);
          beepIndex++;
          buzzerPhase = (beepIndex >= cfg.beepsPerCycle) ? BuzzerPhase::kPause : BuzzerPhase::kGap;
          lastToggleMs = millis();
        }
        break;
      case BuzzerPhase::kGap:
        if (elapsed >= cfg.beepGapMs) {
          setBuzzerPin(true);
          buzzerPhase = BuzzerPhase::kOn;
          lastToggleMs = millis();
        }
        break;
      case BuzzerPhase::kPause:
        if (elapsed >= cfg.pauseMs) {
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
