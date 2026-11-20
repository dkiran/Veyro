import type pg from 'pg';
import { z } from 'zod';
import { config } from './config.js';
import { tx } from './db.js';
import { haversineKm } from './geo.js';
import { publish } from './hub.js';
import { liveStatus } from './status.js';

export const positionSchema = z.object({
  ts: z.coerce.date(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speed_kmh: z.number().min(0).max(500).default(0),
  heading: z.number().min(0).max(360).optional(),
  altitude: z.number().optional(),
  ignition: z.boolean().optional(),
  attrs: z.record(z.unknown()).optional(),
});
export type PositionIn = z.infer<typeof positionSchema>;

export interface DeviceRow { id: string; org_id: string; vehicle_id: string | null }

const MAX_PLAUSIBLE_KMH = 250; // implied speed above this between two fixes = GPS jump, don't count distance

/** Persist a batch of fixes, update live state, derive trips, and push live updates. */
export async function ingestPositions(device: DeviceRow, input: PositionIn[]) {
  if (!device.vehicle_id) return { accepted: 0, skipped: input.length, reason: 'device_not_assigned_to_vehicle' };
  const vehicleId = device.vehicle_id;
  const fixes = [...input].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const now = Date.now();
  const events: unknown[] = [];

  const result = await tx(async (c) => {
    let accepted = 0;
    for (const p of fixes) {
      if (p.ts.getTime() > now + 5 * 60_000) continue; // reject far-future timestamps
      const ins = await c.query(
        `INSERT INTO positions(org_id,vehicle_id,device_id,ts,lat,lng,speed_kmh,heading,altitude,ignition,attrs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (vehicle_id, ts) DO NOTHING`,
        [device.org_id, vehicleId, device.id, p.ts, p.lat, p.lng, p.speed_kmh, p.heading ?? null, p.altitude ?? null, p.ignition ?? null, p.attrs ?? {}],
      );
      if (ins.rowCount === 0) continue; // duplicate
      accepted++;
      const ev = await applyToState(c, device.org_id, vehicleId, p);
      if (ev) events.push(ev);
    }
    await c.query('UPDATE devices SET last_seen = now() WHERE id = $1', [device.id]);
    return accepted;
  });

  // Only the newest event per vehicle matters for the live map.
  const latest = events[events.length - 1];
  if (latest) publish(device.org_id, { type: 'position', data: latest });
  return { accepted: result, skipped: input.length - result };
}

async function applyToState(c: pg.PoolClient, orgId: string, vehicleId: string, p: PositionIn) {
  const prevRes = await c.query('SELECT * FROM vehicle_state WHERE vehicle_id = $1 FOR UPDATE', [vehicleId]);
  const prev = prevRes.rows[0] as undefined | { ts: Date; lat: number; lng: number; idle_since: Date | null; odometer_km: number };

  // Out-of-order (late) fix: kept in history, but doesn't rewind live state or trips.
  if (prev && p.ts.getTime() <= new Date(prev.ts).getTime()) return null;

  let dist = 0;
  if (prev) {
    const d = haversineKm(prev.lat, prev.lng, p.lat, p.lng);
    const hours = (p.ts.getTime() - new Date(prev.ts).getTime()) / 3_600_000;
    if (hours > 0 && d / hours <= MAX_PLAUSIBLE_KMH) dist = d;
  }
  const moving = p.ignition !== false && p.speed_kmh >= config.movingSpeedKmh;
  const idleSince = moving ? null : (prev?.idle_since ?? p.ts);
  const odometer = (prev?.odometer_km ?? 0) + dist;

  // ---- trip derivation ----
  const openRes = await c.query('SELECT id FROM trips WHERE vehicle_id = $1 AND end_ts IS NULL', [vehicleId]);
  const open = openRes.rows[0] as undefined | { id: string };
  if (!open && moving) {
    const drv = await c.query('SELECT driver_id FROM vehicles WHERE id = $1', [vehicleId]);
    // Start the trip at the last stationary fix when it's recent, so the first leg counts.
    const fromPrev = !!prev && p.ts.getTime() - new Date(prev.ts).getTime() <= config.tripIdleEndMs;
    await c.query(
      `INSERT INTO trips(org_id,vehicle_id,driver_id,start_ts,start_lat,start_lng,distance_km,max_speed_kmh) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orgId, vehicleId, drv.rows[0]?.driver_id ?? null, fromPrev ? prev!.ts : p.ts, fromPrev ? prev!.lat : p.lat, fromPrev ? prev!.lng : p.lng, fromPrev ? dist : 0, p.speed_kmh],
    );
  } else if (open) {
    const ignitionOff = p.ignition === false;
    const idleLong = idleSince !== null && p.ts.getTime() - new Date(idleSince).getTime() >= config.tripIdleEndMs;
    if (ignitionOff || idleLong) {
      await c.query(
        `UPDATE trips SET end_ts = $2, end_lat = $3, end_lng = $4, distance_km = distance_km + $5 WHERE id = $1`,
        [open.id, ignitionOff || !idleSince ? p.ts : idleSince, p.lat, p.lng, dist],
      );
    } else {
      await c.query(
        `UPDATE trips SET distance_km = distance_km + $2, max_speed_kmh = GREATEST(max_speed_kmh, $3) WHERE id = $1`,
        [open.id, dist, p.speed_kmh],
      );
    }
  }

  await c.query(
    `INSERT INTO vehicle_state(vehicle_id,org_id,ts,lat,lng,speed_kmh,heading,ignition,idle_since,odometer_km)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (vehicle_id) DO UPDATE SET ts=$3,lat=$4,lng=$5,speed_kmh=$6,heading=$7,ignition=$8,idle_since=$9,odometer_km=$10`,
    [vehicleId, orgId, p.ts, p.lat, p.lng, p.speed_kmh, p.heading ?? null, p.ignition ?? null, idleSince, odometer],
  );

  return {
    vehicle_id: vehicleId, ts: p.ts, lat: p.lat, lng: p.lng, speed_kmh: p.speed_kmh,
    heading: p.heading ?? null, ignition: p.ignition ?? null, odometer_km: odometer,
    status: liveStatus({ ts: p.ts, speed_kmh: p.speed_kmh, ignition: p.ignition ?? null }),
  };
}
