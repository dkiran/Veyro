# Veyro — AI-native fleet management

Phase 1 (this repo): GPS tracking core — live map, trip history & playback, and masters (vehicles, drivers, devices).
Web first; mobile app, WhatsApp bot and voice agent come later and will sit on the same API.

## Quick start
```bash
docker compose up -d                      # Postgres 16 (or point DATABASE_URL at your own)
cd server && npm install && npm start     # API on :4000, migrations run automatically
cd web && npm install && npm run dev      # Web on :5173 (proxies /api and WebSocket)
cd server && npm run simulate             # optional: demo fleet + live GPS (login demo@veyro.app / demo12345)
cd server && npm test                     # integration tests (needs Postgres)
```

## What's built
- **Auth & multi-tenancy**: every row is scoped by `org_id`; JWT; roles `admin|manager|viewer` (viewers are read-only).
- **Masters**: vehicles, drivers, devices (IMEI → vehicle assignment, per-device API key). Cross-tenant references are rejected.
- **Ingest** `POST /api/ingest` (`x-device-key` header): batched, idempotent (`vehicle_id, ts` unique), late/out-of-order fixes kept in history without rewinding live state, GPS-jump filtering, future timestamps rejected.
- **Live**: `GET /api/live/snapshot` + WebSocket `/api/live/ws?token=` pushes each position to the org's browsers.
- **History**: `GET /api/vehicles/:id/history` (server-side downsampling), `GET /api/vehicles/:id/trips`. Trips are derived automatically (start on movement, end on ignition-off or 5 min stationary) with distance, max speed and driver.
- **i18n**: English, Hindi, Marathi, Tamil, Telugu, Bengali, Arabic (RTL), Spanish. Add a language by dropping `web/src/i18n/locales/<code>.json` (copy `en.json`) and adding its native name in `i18n/index.ts`; missing keys fall back to English. Dates/numbers use `Intl`. Drivers carry a `preferred_language` for the future WhatsApp/voice agents.

## Known limits / next steps
- Devices must speak HTTP/JSON. Native TCP protocols (GT06, Teltonika, AIS-140 — important in India) need a gateway that decodes and calls `ingestPositions()`.
- `hub.ts` is in-process; use Postgres LISTEN/NOTIFY or Redis to run multiple API instances.
- `positions` is a plain table; partition by time (e.g. monthly) once volume grows. PostGIS can be added for geofences.
- Map tiles use public OpenStreetMap — switch to a paid/self-hosted tile provider for production.
- Only ~8 languages are translated so far; Indian-language translations should get native-speaker review.

## Roadmap (not built yet)
Geofences & alerts → AI agents (an agent layer that consumes the event stream and uses the same API as tools: anomaly/idle/route-deviation, maintenance, driver scoring) → AI dashcam (video events as `positions.attrs`/new `events` table) → mobile app → WhatsApp bot → voice agent (multilingual, uses driver `preferred_language`).
