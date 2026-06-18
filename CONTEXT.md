# fullstack-gate-sensor

## Current Task
Build out the VPS deploy automation: Dockerfiles, compose files, GitHub Actions workflows, Mosquitto auth, and one-time VPS provisioning. GitHub secrets are already set — this is the remaining file/infra work.

## Active Branch / PR
master (no PR yet)

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
GitHub secrets (`VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`, `VPS_PORT`) are already set on `amrmzfr-dev/fullstack-gate-sensor` — skip that step. Reference implementation: `fullstack-ozone-machine` (sibling repo, same author, same VPS) already runs this exact pattern — `.github/workflows/backend-deploy.yml`, `frontend-deploy.yml`, `docker-compose.prod.yml`/`.dev.yml`, `VPS.md`. Mirror its structure, adapted to the paths/ports below. Do not copy its actual secret values, only the pattern.

**Shared VPS note:** this deploys onto the *same* VPS already running ozone-machine (`ozone-machine-prod-*`/`ozone-machine-dev-*` containers on ports 8080/8081/3000/3001, docker subnets 172.30.0.0/16 / 172.31.0.0/16). Never touch ozone-machine's `/opt/ozone-machine-*` dirs, containers, or volumes.

### 1. Dockerfiles (new)
- `backend/Dockerfile` — multi-stage: `mcr.microsoft.com/dotnet/sdk:8.0` restores/publishes `GateSensor.Api.csproj`; `mcr.microsoft.com/dotnet/aspnet:8.0` runtime stage copies publish output, `EXPOSE 8080`, `ENTRYPOINT ["dotnet", "GateSensor.Api.dll"]`.
- `frontend/Dockerfile` — same shape as `fullstack-ozone-machine/frontend-ozone-react/Dockerfile`: `node:20-bookworm-slim` builder (`npm ci`, `ARG VITE_API_URL`, `npm run build`) → `nginx:alpine` serving `/app/dist`, `COPY frontend/nginx.conf`.
- `frontend/nginx.conf` — same shape as ozone's: no-cache `index.html`, long-cache `/assets/`, SPA fallback, and `location /api/ { proxy_pass http://backend:8080; ... }` so the browser only ever talks to the frontend's own origin. `VITE_API_URL` build arg = literal `/api` for both envs — no secret needed for it.

### 2. Compose files (repo root, new)
- `docker-compose.prod.yml` / `docker-compose.dev.yml` — services: `postgres`, `redis`, `mosquitto`, `backend`, `frontend`, same shape as ozone-machine's (healthchecks, `depends_on: condition: service_healthy`, named volumes, `env_file: .env.prod`/`.env.dev`).
- Ports (host:container), chosen to avoid colliding with ozone-machine on the same box:
  | Service | Prod | Dev |
  |---|---|---|
  | backend | 8090:8080 | 8091:8080 |
  | frontend | 3010:80 | 3011:80 |
  | mosquitto | 1883:1883 | 1884:1883 |
  - `postgres`/`redis`: no host port mapping (internal network only).
- Docker network subnets: **172.32.0.0/16 (prod)**, **172.33.0.0/16 (dev)** — differ from ozone-machine's 172.30/172.31.
- Mosquitto image `eclipse-mosquitto:2`, config volume from `./mosquitto/mosquitto.prod.conf` / `./mosquitto/mosquitto.dev.conf`.

### 3. Mosquitto auth (security)
Broker becomes reachable on the VPS's public IP once deployed — anonymous access would let anyone publish fake `gate/trigger` events or read `gate/buzzer` state.
- Generate password files with `mosquitto_passwd -c mosquitto/passwd.prod <username>` (and `.dev`) — keep the generated hash files out of the repo; place them directly on the VPS during one-time setup (step 6), not committed.
- Set `allow_anonymous false` and `password_file /mosquitto/config/passwd` in both `mosquitto.prod.conf`/`.dev.conf`.
- Add `mqtt_username`/`mqtt_password` fields to the `DeviceConfig` `toml_cfg` struct in both `firmware/transmitter/src/main.rs` and `firmware/receiver/src/main.rs`, pass via `MqttClientConfiguration { username: Some(...), password: Some(...), .. }`. Update both `cfg.toml.example` files with placeholder fields.
- Add matching `username`/`password` to `MqttClientOptionsBuilder` in `backend/Mqtt/MqttRelayHostedService.cs` (currently has none), sourced from `Mqtt:Username`/`Mqtt:Password` config keys set via `.env.prod`/`.env.dev` on the VPS.

### 4. GitHub Actions workflows (new, mirror ozone-machine's structure)
- `.github/workflows/backend-deploy.yml` — trigger on push to `main`/`develop`, `paths: ['backend/**', 'docker-compose.prod.yml', 'docker-compose.dev.yml', '.github/workflows/backend-deploy.yml']` + `workflow_dispatch`. Steps: checkout → `actions/setup-dotnet@v4` (`dotnet-version: '8.0.x'`) → `dotnet build backend/GateSensor.Api.csproj` → `docker/login-action@v3` to `ghcr.io` (`${{ github.actor }}`/`${{ secrets.GITHUB_TOKEN }}`) → `docker/build-push-action@v5` (`context: backend`, tags `ghcr.io/amrmzfr-dev/fullstack-gate-sensor-backend:latest` + `:<short-sha>`) → SSH-stream deploy (`develop`→`/opt/gate-sensor-dev`, `main`→`/opt/gate-sensor-prod`) using the same `docker save | gzip -1 | ssh ... docker load` + `docker tag` + `docker compose stop backend || true && rm -f backend || true && up -d --no-deps backend` sequence as ozone-machine (keep the `|| true` on `rm`).
- `.github/workflows/frontend-deploy.yml` — same shape, `paths: ['frontend/**', ...]`, `actions/setup-node@v4` (node 20) → `npm ci && npx tsc --noEmit` → build-push with `build-args: VITE_API_URL=/api` → tags `ghcr.io/amrmzfr-dev/fullstack-gate-sensor-frontend:dev`/`:prod` + sha → SSH-stream deploy to matching `/opt/gate-sensor-{dev,prod}`, `stop frontend || true && rm -f frontend && up -d --no-deps frontend`.

### 5. One-time manual VPS setup (run once over SSH — not via CI)
- `mkdir -p /opt/gate-sensor-prod /opt/gate-sensor-dev`
- Create `.env.prod`/`.env.dev` directly on the VPS (Postgres password, `Mqtt__Username`/`Mqtt__Password`) — never commit these.
- Generate and place `mosquitto/passwd.prod`/`.dev` per step 3.
- Verify ports 8090/8091/3010/3011/1883/1884 are free (`ss -tlnp`) before first deploy.

### 6. Git
- `git remote add origin https://github.com/amrmzfr-dev/fullstack-gate-sensor.git` (not yet set in this repo) and push `main`/`develop`.

### Carried over (unchanged, already correct)
Backend (`MqttRelayHostedService`, `RedisGateAlertState`, `GateController`), frontend (`DashboardPage`/`useGateMonitor`), and firmware state-machine/WiFi/cfg.toml are otherwise correct — only the additions above are new.

## Decisions Log
- 2026-06-18: Frontend uses Tailwind v4 via `@tailwindcss/vite`, shadcn/ui base-nova style, class-based dark mode.
- 2026-06-18: Backend exposes `GateController`, `SensorController`, `DeviceController` with EF Core + Redis DI wired; cache usage deferred until needed.
- 2026-06-18: Firmware link uses MQTT (Mosquitto) instead of REST polling — single fixed transmitter/receiver pair, explicit user request overriding default REST-only rule. Transmitter owns all on/off timing (5s buzz / 5s cooldown, repeats while sensor stays HIGH); backend is a relay+logger only, not a timer.
- 2026-06-18: Mosquitto added to docker-compose; backend uses MQTTnet 5 relay hosted service; frontend reads gate state exclusively via `GET /api/gate/status` and `GET /api/gate/events`.
- 2026-06-18: Firmware WiFi/MQTT credentials live in per-crate `cfg.toml` (gitignored); `cfg.toml.example` committed in transmitter and receiver. WiFi connect (BlockingWifi/EspWifi) and proper `Peripherals::take()` pin acquisition added to fix initial firmware compile/runtime blockers.
- 2026-06-18: VPS deploy mirrors fullstack-ozone-machine (GHCR build → SSH-streamed image → `docker compose up -d --no-deps`). Gate-sensor uses ports 8090/8091/3010/3011/1883/1884 and subnets 172.32/172.33 to avoid ozone-machine collisions. Frontend uses `VITE_API_URL=/api` with nginx reverse proxy — no per-env API URL secret.

## Known Issues
- 2026-06-18: No on-device or integration testing yet — transmitter/receiver firmware, backend MQTT relay, and dashboard have only been reviewed by source read-through, not run against real ESP32 hardware or a live broker/backend/frontend stack.
- 2026-06-18: GitHub repo secrets (`VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`, `VPS_PORT`) are set on `amrmzfr-dev/fullstack-gate-sensor`. Still pending: one-time VPS setup (`mkdir -p /opt/gate-sensor-{prod,dev}`, `.env.prod`/`.env.dev`, `mosquitto/passwd.*`), `git remote add origin` + push, and the Dockerfiles/compose files/workflows from the Plan above (none of those files exist yet — only the secrets are done).
