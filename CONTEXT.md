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
- 2026-06-18: Backend exposes `GateController`, `SensorController`, `DeviceController` with EF Core + Redis DI wired; cache usage deferred until needed.
- 2026-06-18: Firmware link uses MQTT (Mosquitto) instead of REST polling — single fixed transmitter/receiver pair, explicit user request overriding default REST-only rule. Transmitter owns all on/off timing (5s buzz / 5s cooldown, repeats while sensor stays HIGH); backend is a relay+logger only, not a timer.
- 2026-06-18: Mosquitto added to docker-compose; backend uses MQTTnet 5 relay hosted service; frontend reads gate state exclusively via `GET /api/gate/status` and `GET /api/gate/events`.
- 2026-06-18: Firmware WiFi/MQTT credentials live in per-crate `cfg.toml` (gitignored); `cfg.toml.example` committed in transmitter and receiver. WiFi connect (BlockingWifi/EspWifi) and proper `Peripherals::take()` pin acquisition added to fix initial firmware compile/runtime blockers.
- 2026-06-18: VPS deploy mirrors fullstack-ozone-machine (GHCR build → SSH-streamed image → `docker compose up -d --no-deps`). Gate-sensor uses ports 8090/8091/3010/3011/1883/1884. **Subnets corrected to 172.34.0.0/16 (prod) / 172.35.0.0/16 (dev)** — the originally planned 172.32/172.33 actually collided with another sibling project (`fullstack-fleet-tracking`) already on this shared VPS, not ozone-machine. Frontend uses `VITE_API_URL=/api` with nginx reverse proxy — no per-env API URL secret. Mosquitto `passwd.*` files must be `644` (not `600`) since mosquitto runs as a non-root user in-container and needs read access to the bind-mounted file.

## Known Issues
- 2026-06-18: No on-device or integration testing yet — transmitter/receiver firmware and dashboard have only been reviewed by source read-through, not run against real ESP32 hardware. The MQTT/backend/database leg (Mosquitto auth, Postgres, Redis) has now been verified live on the VPS (see below).
- 2026-06-18: VPS one-time provisioning is done: `/opt/gate-sensor-{prod,dev}` created, `.env.prod`/`.env.dev` populated with generated secrets (not the `change-me` placeholders), `mosquitto/passwd.{prod,dev}` generated and permissioned correctly, postgres/redis/mosquitto containers running and healthy on both envs. Verified live: Mosquitto correctly rejects anonymous publishes and accepts authenticated ones with the generated credentials.
- 2026-06-18: The subnet fix (172.34/172.35) was applied directly to the compose files on the VPS via scp **and** to the local repo files, but has not yet been committed/pushed to git — `main`/`develop` on GitHub still has the old 172.32/172.33 values. Needs a commit, or the next CI deploy will scp the stale subnet back onto the VPS and conflict again.
- 2026-06-18: Backend/frontend containers are not running yet on either env — their images only get created by the first successful CI workflow run (triggered by a push touching `backend/**`/`frontend/**`). Push the subnet fix to trigger it, then verify `docker ps` shows backend+frontend healthy and the dashboard reachable at `http://124.217.246.162:3010` (prod) / `:3011` (dev).
