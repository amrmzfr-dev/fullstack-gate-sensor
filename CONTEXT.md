# fullstack-gate-sensor

## Current Task
Firmware rewritten from Rust to PlatformIO/C++/Arduino (transmitter + receiver); independently verified both compile clean via `pio run` and the on-device logic (GPIO4/5, debounce, 5s cycle, QoS 1) matches the original design.

## Active Branch / PR
main (pushed to origin)

## Stack
- Frontend: React + TypeScript (internal/IoT dashboard)
- Backend: .NET (ASP.NET Core, Controllers)
- DB: PostgreSQL
- Cache: Redis
- IoT/Embedded: C++/Arduino on ESP32 via PlatformIO (AsyncMqttClient, QoS 1)
- UI: Tailwind, shadcn/ui, lucide-react, light+dark mode via `dark:` prefix

## Structure
```
fullstack-gate-sensor/
├── frontend/        # React + TS dashboard
├── backend/         # ASP.NET Core Web API
├── firmware/        # PlatformIO — transmitter/ and receiver/
├── docker-compose.yml
├── .gitignore
└── CONTEXT.md
```

## Plan
_No plan._

## Decisions Log
- 2026-06-18: Firmware link uses MQTT (Mosquitto) instead of REST polling — single fixed transmitter/receiver pair, explicit user request overriding default REST-only rule. Transmitter owns all on/off timing (5s buzz / 5s cooldown, repeats while sensor stays HIGH); backend is a relay+logger only, not a timer.
- 2026-06-18: Mosquitto added to docker-compose; backend uses MQTTnet 5 relay hosted service; frontend reads gate state exclusively via `GET /api/gate/status` and `GET /api/gate/events`.
- 2026-06-18: VPS deploy mirrors fullstack-ozone-machine (GHCR build → SSH-streamed image → `docker compose up -d --no-deps`). Gate-sensor uses ports 8090/8091/3010/3011/1883/1884. Subnets 172.34.0.0/16 (prod) / 172.35.0.0/16 (dev). Frontend uses `VITE_API_URL=/api` with nginx reverse proxy.
- 2026-06-18: Firmware pivoted from Rust/esp-idf-svc to PlatformIO/C++/Arduino — same MQTT topics and state machine, `marvinroger/AsyncMqttClient` for QoS 1. Credentials in gitignored `include/secrets.h` (see `secrets.h.example` per device).

## Known Issues
- 2026-06-18: Firmware compile-verified via `pio run` but not yet flashed or tested on physical ESP32 hardware (IR sensor GPIO4, buzzer GPIO5).
- 2026-06-18: Deploy gotcha (same as ozone-machine): if frontend starts before backend is on the docker network, nginx crash-loops — `docker compose restart frontend` after backend is up.
- 2026-06-18: The PlatformIO firmware rewrite (new `platformio.ini`/`main.cpp` files, deleted Rust files) is sitting uncommitted in the working tree — not yet committed or pushed. Leftover `firmware/target/` Rust build cache was cleaned up.
