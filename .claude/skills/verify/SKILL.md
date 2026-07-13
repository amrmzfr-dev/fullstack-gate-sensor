---
name: verify
description: How to run and visually verify the gate-sensor frontend without the real backend
---

# Verifying the frontend

The frontend is a Vite + React app in `frontend/`. The backend (ASP.NET, port 5115 locally)
usually isn't running — mock it at the browser level instead.

## Launch

```bash
cd frontend && npx vite --port 5199 --strictPort   # run in background
```

## Drive with Playwright

Playwright is NOT a project dependency. Install it in a temp dir (browsers are already
cached in `%LOCALAPPDATA%/ms-playwright`):

```bash
mkdir -p "$TMP/pw-verify" && cd "$TMP/pw-verify" && npm init -y && npm i playwright
```

Then a Node script with `context.route("http://localhost:5115/**", ...)` to mock the API.
Endpoints the UI calls (all under `http://localhost:5115/api`):

- `GET /gate/status` → `{ alertActive, updatedAt }`
- `GET /gate/events?limit=50` → `[{ id, event: "on"|"off", timestamp, relayedAt, receiverConfirmedAt }]`
- `GET /device/status` → `[{ device, online, lastSeenAt, firmwareVersion, ipAddress }]`
- `GET /device/config` → `{ receiver: {...}, transmitter: {...} }` (see `frontend/src/types/index.ts`)
- `POST /device/receiver/acknowledge` → `{ cooldownMs }`
- `POST /device/receiver/test` → `{ tested: true }`
- `GET /firmware` → `[{ device, manifest }]`

## Flows worth driving

- Mobile (viewport ≤767px, e.g. 390x844): `MobileDashboardPage` with bottom tab bar
  (Home / Events / Settings / Firmware). Desktop (≥768px): `DashboardPage`.
  The split is `useIsMobile` (matchMedia) in `App.tsx` — resizing across 768px swaps live.
- Acknowledge button → "Silenced — buzzer stays quiet for Ns" message.
- Mobile tabs stay mounted when inactive (hidden via CSS) so unsaved settings edits survive.
- Check `document.documentElement.scrollWidth - clientWidth === 0` (no horizontal overflow).
- Theme toggle adds `dark` class on `<html>`.

## Gotchas

- `npm run lint` has 6 pre-existing errors (react-hooks/set-state-in-effect etc.) — not a regression signal.
- `npm run build` runs `tsc -b` first, so build success == typecheck success.
