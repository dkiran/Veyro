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
- **Dashboard** (landing page after login, `GET /api/dashboard?days=1|7|30|90`): live fleet status tiles + donut (running / idle / stopped / no GPS), fleet utilization, trips, driver behaviour and fuel, with auto-refresh. Everything is computed in SQL from positions, trips and vehicle state.
  - *Driver behaviour* is derived from GPS speed changes (overspeed > 80 km/h, harsh braking/acceleration >= 8 km/h per second). Exact events need an AI dashcam or accelerometer. The score formula is `100 - 4 x events per 100 km`.
  - *Fuel is an estimate* (distance / typical km-per-litre by vehicle type + idle burn, at reference India prices in `server/src/fuel.ts`) until fuel sensors or fuel cards are connected. Currency is INR for now.
  - Dashboard text is translated into English and Hindi; other languages fall back to English until translated.
- **Live tracking drawer**: collapsible vehicle list (remembers open/closed), status filter chips, search, and a vehicle photo per row. Set a vehicle's *image URL* in Masters > Vehicles; if it is missing or fails to load, a vehicle-type icon is shown instead. Only http(s) URLs are accepted.
- **Masters menu**: Vehicles, Drivers, Devices and Trips (filterable, paged trip list; each row opens its route in History).
- **AI assistant** (chat bubble, bottom right): streaming chat that answers questions about your own fleet by calling read-only tools (`fleet_status`, `find_vehicle`, `vehicle_trips`, `fleet_summary`, `list_drivers`, `device_health`). Runs on the Claude API from the server (`server/src/assistant/`). Set `ANTHROPIC_API_KEY` in `server/.env` to enable it; without a key the bubble explains that it isn't set up. Safeguards: the company id comes from the login token, never from the model; tools are read-only; 20 messages/minute/user; input length limits. It replies in the user's language. It cannot change data yet; actions (send a WhatsApp alert, create a driver...) should be added as separate tools with a confirmation step.
- **i18n**: English, Hindi, Marathi, Tamil, Telugu, Bengali, Arabic (RTL), Spanish. Add a language by dropping `web/src/i18n/locales/<code>.json` (copy `en.json`) and adding its native name in `i18n/index.ts`; missing keys fall back to English. Dates/numbers use `Intl`. Drivers carry a `preferred_language` for the future WhatsApp/voice agents.

## Known limits / next steps
- Devices must speak HTTP/JSON. Native TCP protocols (GT06, Teltonika, AIS-140 — important in India) need a gateway that decodes and calls `ingestPositions()`.
- `hub.ts` is in-process; use Postgres LISTEN/NOTIFY or Redis to run multiple API instances.
- `positions` is a plain table; partition by time (e.g. monthly) once volume grows. PostGIS can be added for geofences.
- Map tiles use public OpenStreetMap — switch to a paid/self-hosted tile provider for production.
- Only ~8 languages are translated so far; Indian-language translations should get native-speaker review.

## Roadmap (not built yet)
Geofences & alerts → AI agents (an agent layer that consumes the event stream and uses the same API as tools: anomaly/idle/route-deviation, maintenance, driver scoring) → AI dashcam (video events as `positions.attrs`/new `events` table) → mobile app → WhatsApp bot → voice agent (multilingual, uses driver `preferred_language`).

## Deploying to your own domain (single server)
Prereqs: Node 22, Docker (for Postgres), a server with ports 80 and 443 open, and a DNS **A record** for your domain pointing at the server's (Elastic) IP.
```bash
git pull && ./deploy/install.sh
```
This builds the web app into `/var/www/veyro`, runs the API as the `veyro-api` systemd service on `127.0.0.1:4000`, and installs Caddy, which serves the site and gets a free HTTPS certificate automatically. Re-run it after every `git pull`. To use another domain or a subdomain, edit `deploy/Caddyfile` and `DOMAIN_NAME` in `deploy/install.sh`. In production the API only accepts same-origin browser calls unless `CORS_ORIGIN` is set.
