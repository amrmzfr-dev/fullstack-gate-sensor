# Firmware Audit — Transmitter + Receiver

**Scope:** `firmware/transmitter/src/main.cpp`, `firmware/receiver/src/main.cpp`, and the
MQTT/OTA contract they share with `backend/Mqtt/MqttRelayHostedService.cs`.
**Date:** 2026-07-08
**Boards:** ESP32 (esp32dev), Arduino framework, AsyncMqttClient (QoS 1), WiFiManager.

---

## System recap (as built)

- **Transmitter** — IR sensor on GPIO4 (`INPUT_PULLDOWN`, HIGH = blocked). On a debounced
  block it publishes `gate/trigger {"event":"on"}` and re-pings every 5 s while blocked;
  publishes `{"event":"off"}` once when clear.
- **Backend** — logs each trigger to Postgres, sets alert state, and republishes
  `gate/buzzer {"on":…,"eventId":…}` **retained, QoS 1**. Also publishes retained OTA
  manifests to `firmware/{device}/latest`.
- **Receiver** — subscribes to `gate/buzzer`; every `"on"` (re)arms a rolling 7 s window and
  runs a 5-beep/pause pattern; ignores `"off"` and self-silences when the window lapses.
  Acks each buzzer message to `gate/receiver/ack`.
- **OTA** — both boards download a `.bin` over **plain HTTP** and verify **MD5 only**.

The 5 s re-ping vs. 7 s window is the core timing contract: a ping must always land before
the previous window expires.

---

## Severity summary

| # | Finding | Severity |
|---|---------|----------|
| 1 | OTA has no authenticity — plain HTTP + MD5, attacker-controllable manifest | **Critical** |
| 2 | Broker on public IP, port 1883, no TLS — credentials in the clear | **Critical** |
| 3 | No liveness/heartbeat/LWT — a dead transmitter *or* receiver is invisible | **High** |
| 4 | Sensor fails silent — cut/dead IR wire reads "clear", never faults | **High** |
| 5 | Retained `on` buzzer → phantom alarm on every receiver reboot | **High** |
| 6 | Shared fixed MQTT client IDs → trivial remote DoS via session takeover | **High** |
| 7 | Cross-task data races on OTA/alert state (incl. `String`) — no `volatile`/lock | **High** |
| 8 | OTA downgrade/rollback accepted — any version ≠ current is flashed | **Medium** |
| 9 | Receiver deadline check is not millis()-overflow-safe | **Medium** |
| 10 | MD5 optional — missing `md5` in manifest disables the only integrity check | **Medium** |
| 11 | Dashboard alert state diverges from the physical buzzer | **Medium** |
| 12 | Real VPS IP committed in `secrets.h.example` | **Low** |
| 13 | Open (no-password) WiFi config portal | **Low** |
| 14 | Two firmwares silently share the 5 s/7 s timing invariant | **Low** |
| 15 | Blocking OTA download blinds/deafens the device; chunked-encoding breaks OTA | **Low** |

---

## Fix status (updated 2026-07-08)

**Fixed in code (compile-verified across firmware, backend, and frontend):**
- #5 retained-buzzer phantom alarm — receiver ignores retained buzzer replays.
- #6 fixed client IDs — both boards now append the chip MAC (`gate-receiver-<MAC>`), ending the session-takeover DoS.
- #7 cross-task races — buzzer state moved wholly into `loop()`; OTA handoff copies under a spinlock into fixed buffers.
- #8 OTA downgrade — manifests are accepted only if strictly newer (semver compare).
- #9 millis() overflow — receiver deadline uses a signed difference.
- #10 OTA missing hash — a manifest with no `md5` is now refused.
- #3 liveness (partial) — both boards publish a retained MQTT status with a Last Will "offline" plus a 30 s heartbeat; the backend tracks it in Redis (staleness-checked) and exposes `GET /api/device/status`; the dashboard shows a live **Devices** panel (online/offline, firmware version, IP, last seen). This makes a dead board *visible*; automatic escalation/alerting on offline is still open.

**Deferred — need infrastructure or decisions the code alone can't settle (left per owner's call to skip security):**
- #1 OTA authenticity (HTTPS + image signature) — needs a TLS-served binary and a signing key/pipeline.
- #2 MQTT over TLS — needs broker certs + an 8883 listener; risky to flip on a live plaintext deployment without testing.
- #4 sensor fail-silent — needs a wiring/hardware supervision change, not a code edit.
- #11 dashboard alert-state divergence — deeper backend rework of the alert model.
- #15 blocking OTA / chunked-encoding — low value; current server sends `Content-Length`.

---

## Critical

### 1. OTA update has integrity but no *authenticity* (plain HTTP + MD5)
`performOta()` (both boards) downloads over `http://` and, at best, checks an MD5 supplied by
the **same manifest** that supplied the URL. MD5 proves the bytes weren't corrupted in
transit — it proves nothing about *who* produced them. An attacker computes the MD5 of their
own malicious image just as easily.

Two independent paths to arbitrary code execution on the ESP32:
- **Malicious manifest.** Anyone able to publish `firmware/{device}/latest` (see #2 — the
  broker is reachable and uses one shared credential) sets `url`/`md5` to their own image.
  The manifest is *retained*, so it also auto-delivers to every device that reconnects.
- **MITM on the download.** Because the fetch is `http://`, anyone on-path (same LAN, the VPS
  network, upstream) rewrites the response body and the MD5 line and the device flashes it.

The code comments already acknowledge this ("No HTTPS yet… tighten before treating it as
hardened"). It should be treated as an open remote-code-execution hole, not a to-do.

**Direction:** fetch over HTTPS with a pinned CA/cert, and require a **signature** over the
image (e.g. Ed25519 verified against a public key baked into the firmware) — not a hash.
ESP32 secure boot + signed app images is the platform-native answer.

### 2. Broker is on a public IP, port 1883, no TLS
`secrets.h.example` points at `124.217.246.162:1883` with a username/password. Port 1883 is
plaintext MQTT. The CONNECT packet — including the shared credentials — crosses the open
internet unencrypted, as does every trigger/buzzer/manifest message. One packet capture
yields the credentials, after which an attacker can:
- publish `gate/buzzer {"on":true}` to sound the alarm at will (nuisance / alarm fatigue);
- publish a poisoned OTA manifest (#1) for full device takeover;
- takeover device sessions (#6).

**Direction:** MQTT over TLS (8883) with per-device credentials and, ideally, client
certificates; broker ACLs so a device may only publish/subscribe its own topics.

---

## High

### 3. No liveness detection — a dead device is invisible
There is no MQTT Last Will & Testament and no periodic heartbeat on either board. The whole
purpose of the system is "something is at the gate → a buzzer sounds." Yet:
- If the **transmitter** loses power or WiFi, it simply stops publishing. Nothing detects
  this; the gate is silently unmonitored.
- If the **receiver** is offline (or has been silently re-flashed/bricked via #1), no alarm
  sounds and *nothing notices*. The ack (`gate/receiver/ack`) exists and the backend stores
  `ReceiverConfirmedAt`, but nothing ever checks for a *missing* ack, so an unacknowledged
  alert never raises "the alarm didn't fire."

**Direction:** register an MQTT LWT per device (retained `online:false`), publish periodic
heartbeats, and have the backend alarm when a heartbeat lapses or when an `on` trigger is not
acked by the receiver within a short deadline.

### 4. The IR sensor fails silent
GPIO4 is `INPUT_PULLDOWN` and a *block* is HIGH. If the sensor loses power, its signal wire is
cut, or it's disconnected, the pin reads LOW — indistinguishable from "nothing there." A
sensor that has died or been sabotaged produces exactly the same reading as a clear gate: no
alert, no fault. For a security-adjacent sensor this is the wrong failure mode (fail-silent
instead of fail-safe/fail-loud).

**Direction:** add supervision — e.g. an expected idle signature, a periodic self-test, or a
normally-energized (fail-open-to-alarm) wiring scheme — so "sensor absent" is detectable and
distinct from "gate clear."

### 5. Retained `on` buzzer message → phantom alarm on reboot
The backend publishes `gate/buzzer` with **retain = true**. The receiver subscribes on every
connect and acts on `on:true`. If the last retained buzzer message is `on:true`, then **every
time the receiver reconnects it immediately buzzes for a full 7 s**, even though nothing is at
the gate.

This isn't just the moment of a real event. The retained message stays `on` until an `off`
overwrites it — and an `off` never comes if the transmitter loses power *while the gate is
blocked* (see #3). Result: a stuck retained `on` that makes the receiver false-alarm on every
power blip, WiFi flap, or OTA restart, indefinitely.

**Direction:** don't retain a transient command topic; or have the receiver ignore retained
buzzer messages on reconnect (act only on live ones); or expire/clear the buzzer state
server-side with an explicit `off` when a trigger session ends or times out.

### 6. Fixed client IDs enable remote session-takeover DoS
Every receiver connects as `gate-receiver`, every transmitter as `gate-transmitter`. MQTT
brokers evict an existing session when a new client connects with the same ID — the
transmitter's own `setup()` comment documents this exact "session taken over" fight. An
attacker with the shared credential (#2) simply connects in a loop as `gate-receiver` and
keeps the real receiver kicked off the broker — the buzzer never hears a trigger. Same for the
transmitter. This is a one-line denial of the entire alerting function.

**Direction:** unique per-device client IDs (e.g. include the MAC), per-device credentials,
and broker ACLs restricting each ID to its own topics.

### 7. Shared state is read/written from two tasks with no synchronization
AsyncMqttClient callbacks run on the AsyncTCP task; `loop()` runs on the Arduino task (ESP32
is dual-core). These are touched from both with no `volatile`, atomics, or lock:
- `otaPending`, `otaUrl`, `otaMd5` — and `otaUrl`/`otaMd5` are Arduino `String` objects.
- Receiver: `buzzerActive`, `alertDeadlineMs`, `beepIndex`, `buzzerPhase`, `lastToggleMs`.

Two concrete hazards:
- **Store reordering.** The callback sets `otaUrl` then `otaPending = true`. Without a memory
  barrier, `loop()` on the other core can observe `otaPending == true` before the `otaUrl`
  write is visible, and flash from a stale/empty URL.
- **`String` data race / heap corruption.** If a second retained manifest arrives and
  reassigns `otaUrl` while `performOta()` is reading it (or between `otaPending=false` and the
  read), the `String`'s internal buffer can be freed/reallocated under the reader — classic
  heap corruption, hard to reproduce, easy to crash-loop.

**Direction:** mark cross-task flags `volatile` at minimum; better, hand OTA jobs across via a
FreeRTOS queue and copy the URL/MD5 into loop-owned buffers under that handoff; guard the
buzzer state with a critical section or move all mutation into `loop()`.

---

## Medium

### 8. OTA accepts downgrades / rollbacks
`onFirmwareManifest()` flashes whenever `version != kFirmwareVersion`. Any *different* version
is accepted, including an **older** one. Combined with the retained, unauthenticated manifest
(#1/#2), an attacker can roll a device back to a known-vulnerable build.

**Direction:** only accept strictly-newer versions (compare semver), and gate the whole thing
behind the signature check from #1.

### 9. Receiver's deadline check is not overflow-safe
Receiver `loop()`: `if (buzzerActive && millis() >= alertDeadlineMs)`. `millis()` wraps to 0
about every 49.7 days. `alertDeadlineMs = millis() + 7000` can wrap to a small value near the
rollover; the absolute `>=` comparison then reads as "already past," cutting an active alarm
short (or, on the other side of the wrap, mis-timing it). The pulse timing and the
transmitter's `now - lastPingMs >= interval` use unsigned *subtraction* and are correctly
overflow-safe — only this absolute comparison is not.

**Direction:** compare with signed difference, e.g. `(int32_t)(millis() - alertDeadlineMs) >= 0`.

### 10. MD5 is optional
`performOta()` only calls `Update.setMD5()` when `expectedMd5.length() > 0`. A manifest with no
`md5` field flashes with **zero** integrity checking. On plain HTTP that means any truncation,
corruption, or tamper is accepted silently.

**Direction:** treat a missing hash/signature as a hard failure — refuse the update.

### 11. Dashboard alert state diverges from physical reality
The backend sets alert state `on` on trigger `on` and `off` on trigger `off`, but the receiver
**ignores `off`** and rides its own 7 s window. So the dashboard's "alerting" flag and whether
the buzzer is actually sounding are two independent truths:
- Transmitter dies mid-block → no `off` ever sent → backend shows "alert active" forever while
  the buzzer went quiet after 7 s.
- Brief block → backend flips to `off` quickly, but the receiver is still buzzing out its
  minimum window.

**Direction:** derive dashboard state from the same rolling-window/heartbeat model the receiver
uses, or have the receiver report its actual buzzing state, so the UI reflects the field.

---

## Low / hardening

### 12. Real VPS IP committed in `secrets.h.example`
`secrets.h.example` hardcodes `124.217.246.162`. Even though credentials are placeholders, the
example leaks the production broker's address into git history. Use a placeholder host.

### 13. WiFi config portal is an open AP
`wm.autoConnect("GateSensor-…-Setup")` starts an **open** (no-password) access point for up to
180 s on first boot or after a reset. Anyone in range can join it and drive the portal.
Set a portal password (`wm.setConfigPortalTimeout` is set, but no AP password/PSK).

### 14. The 5 s/7 s timing invariant is shared but uncoordinated
The "re-ping (5 s) must stay under the receiver window (7 s)" contract lives as two separate
constants in two independently-flashed binaries. An OTA that updates one board's timing but not
the other silently breaks the invariant (gaps in the alarm, or worse). Document it as a
protocol version and check compatibility, or centralize the window server-side.

### 15. Blocking OTA download; chunked encoding unsupported
`performOta()` runs a blocking download inside `loop()`. During an update the transmitter can't
read the sensor and the receiver can't buzz — a window of no protection (and, via #1, an
attacker-triggerable one). Separately, `http.getSize()` returns -1 for chunked
`Transfer-Encoding`, which this code rejects as "invalid content length," so some server
configs will fail OTA outright.

---

## Smaller notes
- **Buzzer `StaticJsonDocument<64>`** is tight for `{"on":…,"eventId":"<36-char GUID>"}`; verify
  headroom or bump it. (`StaticJsonDocument` is also deprecated in ArduinoJson v7, which the
  `platformio.ini` pins — prefer `JsonDocument`.)
- **`publishTrigger()` ignores the publish return.** It returns `true` whenever the
  `mqttConnected` *flag* is set, even if the enqueue failed or the flag is momentarily stale, so
  the "never lose the first `on`" guarantee is best-effort, not verified.
- **GPIO5 (buzzer) is an ESP32 strapping pin.** A low-level-trigger module that pulls it low at
  boot can disturb strapping; confirm boot is unaffected. (Also recall the hardware note:
  buzzer VCC must be 3.3 V, not 5 V.)
- **Receiver logs only "Subscribed to buzzer"** though it also subscribes to the firmware topic
  — cosmetic.

---

## Suggested priority order
1. Close the OTA RCE: HTTPS + image signature, require the hash, reject downgrades (#1, #8, #10).
2. Lock down transport: TLS + per-device creds/ACLs + unique client IDs (#2, #6).
3. Add liveness: LWT + heartbeats + missing-ack alarming (#3), and make the sensor fail-loud (#4).
4. Fix the retained-`on` phantom alarm and the state divergence (#5, #11).
5. Fix the concurrency races and the overflow-unsafe deadline (#7, #9).
