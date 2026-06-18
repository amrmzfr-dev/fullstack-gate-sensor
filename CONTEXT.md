# fullstack-gate-sensor

## Current Task
_No active task._

## Active Branch / PR
main (pushed to origin)

## Stack
- Frontend: React + TypeScript (internal/IoT dashboard)
- Backend: .NET (ASP.NET Core, Controllers)
- DB: PostgreSQL
- Cache: Redis
- IoT/Embedded: Rust on ESP32, REST only
- UI: Tailwind, shadcn/ui, lucide-react, light+dark mode via `dark:` prefix

## Structure
```
fullstack-gate-sensor/
├── frontend/        # React + TS dashboard
├── backend/         # ASP.NET Core Web API
├── firmware/        # existing/legacy firmware — do not regenerate, see note below
├── docker-compose.yml
├── .gitignore
└── CONTEXT.md
```

## Plan
_No plan._

## Decisions Log
- 2026-06-18: Frontend uses Tailwind v4 via `@tailwindcss/vite`, shadcn/ui base-nova style, class-based dark mode.
- 2026-06-18: Backend exposes `GateController`, `SensorController`, `DeviceController` with EF Core + Redis DI wired; cache usage deferred until needed.
- 2026-06-18: Firmware link uses MQTT (Mosquitto) instead of REST polling — single fixed transmitter/receiver pair, explicit user request overriding default REST-only rule. Transmitter owns all on/off timing (5s buzz / 5s cooldown, repeats while sensor stays HIGH); backend is a relay+logger only, not a timer.
- 2026-06-18: Mosquitto added to docker-compose; backend uses MQTTnet 5 relay hosted service; frontend reads gate state exclusively via `GET /api/gate/status` and `GET /api/gate/events`.
- 2026-06-18: Firmware WiFi/MQTT credentials live in per-crate `cfg.toml` (gitignored); `cfg.toml.example` committed in transmitter and receiver. WiFi connect (BlockingWifi/EspWifi) and proper `Peripherals::take()` pin acquisition added to fix initial firmware compile/runtime blockers.
- 2026-06-18: VPS deploy mirrors fullstack-ozone-machine (GHCR build → SSH-streamed image → `docker compose up -d --no-deps`). Gate-sensor uses ports 8090/8091/3010/3011/1883/1884 and subnets 172.32/172.33 to avoid ozone-machine collisions. Frontend uses `VITE_API_URL=/api` with nginx reverse proxy — no per-env API URL secret.

## Known Issues
- 2026-06-18: No on-device or integration testing yet — transmitter/receiver firmware, backend MQTT relay, and dashboard have only been reviewed by source read-through, not run against real ESP32 hardware or a live broker/backend/frontend stack.
- 2026-06-18: One-time VPS setup still required before first deploy succeeds: `mkdir -p /opt/gate-sensor-{prod,dev}`, copy `.env.prod`/`.env.dev` from `.env.*.example`, generate `mosquitto/passwd.*` on VPS, then `docker compose up -d` for the full stack (postgres/redis/mosquitto) before CI backend/frontend deploys.
