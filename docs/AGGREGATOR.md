# Veyro Data Aggregator: design

## Goal
One neutral place where a shipper can see the live location of any vehicle it has hired, whichever GPS vendor the
transporter uses, without installing new hardware and without integrating with each vendor. A vehicle keeps one identity
when it moves between shippers; access follows consent, not hardware.

Non-goals (for now): reselling raw vendor data without consent, replacing the vendor's own customer relationship,
building our own tracker hardware.

## Actors
| Org type | What they do |
|---|---|
| **Transporter** | Owns vehicles. Approves who may see each vehicle, for what period. Also uses the normal fleet app. |
| **Shipper** | Hires vehicles. Sees only approved vehicles during the approved window, via portal, API, webhooks. |
| **GPS vendor** | Supplies data feeds (push or pull). Gets an integration console and a health dashboard. |
| **Veyro admin** | Verifies vehicles/orgs, monitors feed health, handles disputes. |

## Core concepts
- **Canonical vehicle**: identified by registration number (normalised, e.g. `MH12AB1234`). One row, many sources.
- **Source**: a way we receive data for a vehicle: a device (IMEI) sending to our gateway, a vendor push feed, or a vendor API we pull.
  Several sources can exist for one vehicle. We de-duplicate and pick the freshest/best.
- **Ownership claim**: a transporter claims a vehicle by registration number, verified (RC document, vendor confirmation, or device
  handshake) before it can be shared.
- **Assignment**: transporter grants a shipper access to a vehicle for a window (trip, consignment or contract dates). Auto-expires. Revocable.
- **Consent ledger**: append-only record of every grant, change and revocation (who, what, when, why).
- **Access policy engine**: one function every read path calls (REST, WebSocket, webhook, export). Default deny.
- **Access audit log**: every read of a vehicle by a shipper, visible to the transporter.

## How data gets in (three paths, one adapter layer)
1. **Device dual-forward**: transporter adds Veyro as a second server on the existing tracker (most trackers support a secondary IP/port).
   Needs a TCP/UDP gateway with protocol adapters (GT06/Concox, JT808, Teltonika, AIS-140 first). No vendor agreement needed.
2. **Vendor push**: vendor forwards normalised JSON to our Vendor Integration API (spec below). Simplest for vendors; needs an agreement.
3. **Vendor pull**: we poll the vendor's API using credentials the transporter gives us. Works without vendor cooperation if they have an API;
   check their terms first.

All three produce the same internal event: `NormalisedPosition`.

```
NormalisedPosition { registration?, device_id?, source_id, ts, lat, lng, speed_kmh, heading, ignition, odometer_km?, attrs{} , received_at }
```
Late, duplicate and out-of-order fixes are handled exactly as in the current ingest code (idempotent on vehicle + ts).

## What a shipper can see
- Position, speed, ignition, last update, trip status/ETA: **only while assigned**.
- Not: driver name/phone, history outside the window, other vehicles of the transporter, which vendor the vehicle uses (unless transporter allows).
- Every read is audited. Rate limits and per-key scopes apply.

## Data model additions (sketch)
`organizations.type`, `vehicle_registry(registration, verified_at, ...)`, `vehicle_owner_claims`, `sources`(type, vendor_id, credentials_ref, health),
`source_vehicle_map`, `assignments(vehicle, shipper, from, to, status, scope)`, `consent_events` (append-only), `access_audit`,
`api_keys(scopes, org)`, `webhooks`, `vendor_feeds(health, last_seen, lag)`.

## Vendor Integration API v1 (outline, to publish for vendors)
`POST /vendor/v1/positions` with `Authorization: Bearer <vendor key>`; body: array of positions with registration number (and optional device id),
ISO-8601 UTC timestamps, WGS84 lat/lng, speed in km/h. Idempotent by (registration, ts). Batches up to 1000. Rate limits published.
Sandbox with a feed simulator so a vendor can integrate in an afternoon. Health endpoint and a dashboard showing freshness and error rate.

## Shipper API v1 (outline)
`GET /v1/vehicles` (approved only), `GET /v1/vehicles/{reg}/location`, `GET /v1/vehicles/{reg}/history?from&to` (clamped to the assignment window),
`POST /v1/consignments`, webhooks for `position`, `geofence`, `delay`, `assignment.ended`; WebSocket stream. OpenAPI spec, scoped keys, sandbox.

## Scale path
Today: one Postgres, in-process fan-out, one server. Pilot scale is fine. Before country scale:
time-partitioned positions (TimescaleDB or native partitions, still Postgres), a queue between gateway and writers (Redis Streams/NATS first, Kafka if needed),
stateless horizontally scaled gateway, read replicas, caching of latest position per vehicle, multi-AZ. Load-test targets are part of each milestone.
Host data in India (AWS Mumbai, ap-south-1) before real customer data arrives; the current server is in Sydney.

## Legal and trust checklist (needs a lawyer, not just code)
- India's DPDP Act: lawful basis and consent records, purpose limitation, retention limits, deletion/export requests, grievance contact.
- GPS vendor terms often forbid resale or sharing; get written permission or use device dual-forward/transporter-supplied credentials only where allowed.
- Data processing agreements with transporters, vendors, shippers. Clear statement of who is controller/processor.
- Security: encryption in transit/at rest, key management, least-privilege, independent security audit before large customers.
- AIS-140/VLTD: our role (a private backend) differs from state control-room obligations; confirm what applies.

## Risks
1. No vendor cooperation yet: mitigate with device dual-forward and a vendor-friendly spec + sandbox.
2. Vehicle identity mismatch (typos, re-registration): verification step and manual admin merge.
3. Chicken-and-egg (shippers want coverage, vendors want shippers): start with 1 shipper + 2-3 transporters on any vendor.
4. Privacy incident: default-deny policy engine, audit log, and tests that prove tenants cannot read each other's data.
