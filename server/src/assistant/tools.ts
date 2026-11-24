import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { pool } from '../db.js';
import { liveStatus } from '../status.js';
import { buildDashboard } from '../routes/dashboard.js';

/**
 * Read-only tools the assistant can call. SECURITY: `org` is bound by the server from the signed-in
 * user's token; the model never supplies or sees an org id, so it can only read its own tenant's data.
 */
const MAX_RESULT_CHARS = 12_000;

export const toolDefs: Anthropic.Tool[] = [
  {
    name: 'fleet_status',
    description: 'Current live status of the whole fleet: counts of running, idle, stopped and no-GPS vehicles, plus the vehicles in each group (registration, driver, speed, last update). Use for "how many vehicles are running/stopped/offline" and "which vehicles are ...".',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_vehicle',
    description: 'Look up vehicles by registration number or name (partial match). Returns type, status, assigned driver, last known position (lat/lng), speed, ignition and odometer. Use for "where is MH12AB1001" or "what is Truck 3 doing".',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Part of the registration number or vehicle name' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'vehicle_trips',
    description: 'Trips for one vehicle over the last N days (start/end time, distance km, max speed, driver) with totals.',
    input_schema: { type: 'object', properties: { vehicle: { type: 'string', description: 'Registration number (exact, spaces ignored)' }, days: { type: 'integer', minimum: 1, maximum: 30, description: 'Look-back window, default 7' } }, required: ['vehicle'], additionalProperties: false },
  },
  {
    name: 'fleet_summary',
    description: 'Aggregated fleet metrics for the last 1, 7, 30 or 90 days: utilization, trips and distance, driver behaviour (overspeed / harsh braking / harsh acceleration events, driver scores) and ESTIMATED fuel cost. Use for performance, safety, fuel and utilization questions.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', enum: [1, 7, 30, 90], description: 'Window in days, default 7' } }, additionalProperties: false },
  },
  {
    name: 'list_drivers',
    description: 'Drivers with phone, licence number and expiry, preferred language, status and assigned vehicle. Optionally filter by name, or set licence_expiring_days to only list licences that expire (or already expired) within that many days.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, licence_expiring_days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false },
  },
  {
    name: 'device_health',
    description: 'GPS tracker devices that have not reported for at least N minutes (default 30), or never reported. Use for "which trackers are offline".',
    input_schema: { type: 'object', properties: { silent_minutes: { type: 'integer', minimum: 5, maximum: 10080 } }, additionalProperties: false },
  },
];

const schemas = {
  fleet_status: z.object({}).strict(),
  find_vehicle: z.object({ query: z.string().trim().min(1).max(60) }),
  vehicle_trips: z.object({ vehicle: z.string().trim().min(2).max(30), days: z.number().int().min(1).max(30).default(7) }),
  fleet_summary: z.object({ days: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)]).default(7) }),
  list_drivers: z.object({ name: z.string().trim().max(60).optional(), licence_expiring_days: z.number().int().min(1).max(365).optional() }),
  device_health: z.object({ silent_minutes: z.number().int().min(5).max(10080).default(30) }),
} as const;

const r1 = (n: number) => Math.round(n * 10) / 10;
const cap = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length <= MAX_RESULT_CHARS ? s : s.slice(0, MAX_RESULT_CHARS) + '…[truncated]';
};

async function vehicleRows(org: string, where = '', params: unknown[] = []) {
  return (await pool.query(
    `SELECT v.id, v.reg_number, v.name, v.type, v.status AS vehicle_status, d.name AS driver, s.ts, s.lat, s.lng, s.speed_kmh, s.ignition, s.odometer_km
       FROM vehicles v LEFT JOIN drivers d ON d.id = v.driver_id LEFT JOIN vehicle_state s ON s.vehicle_id = v.id
      WHERE v.org_id = $1 ${where} ORDER BY v.reg_number`, [org, ...params])).rows;
}
const shape = (v: any) => ({
  registration: v.reg_number, name: v.name, type: v.type, vehicle_status: v.vehicle_status, driver: v.driver,
  live_status: v.ts ? liveStatus(v) : 'no_gps', last_update: v.ts ?? null,
  position: v.ts ? { lat: v.lat, lng: v.lng } : null, speed_kmh: v.ts ? r1(v.speed_kmh) : null, ignition: v.ignition, odometer_km: v.ts ? r1(v.odometer_km) : null,
});

/** Runs one tool. Returns a JSON string; throws only for unknown tool names. Invalid input yields an error result the model can correct. */
export async function runTool(org: string, name: string, input: unknown): Promise<{ content: string; isError?: boolean }> {
  const schema = (schemas as Record<string, z.ZodTypeAny>)[name];
  if (!schema) return { content: `Unknown tool: ${name}`, isError: true };
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) return { content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`, isError: true };
  const a: any = parsed.data;

  switch (name) {
    case 'fleet_status': {
      const rows = (await vehicleRows(org)).map(shape);
      const groups: Record<string, any[]> = { moving: [], idle: [], stopped: [], offline: [], no_gps: [] };
      for (const v of rows) (groups[v.live_status === 'unknown' ? 'no_gps' : v.live_status] ??= []).push({ registration: v.registration, driver: v.driver, speed_kmh: v.speed_kmh, last_update: v.last_update });
      const counts = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
      return { content: cap({ total: rows.length, counts, note: '"offline" = no GPS fix for 10+ minutes; the dashboard counts offline and no_gps together as "No GPS".', groups }) };
    }
    case 'find_vehicle': {
      const like = `%${a.query.replace(/[%_\\]/g, '\\$&').replace(/\s+/g, '')}%`;
      const rows = await vehicleRows(org, `AND (v.reg_number ILIKE $2 OR replace(v.name, ' ', '') ILIKE $2)`, [like]);
      return { content: cap({ matches: rows.slice(0, 10).map(shape), total_matches: rows.length }) };
    }
    case 'vehicle_trips': {
      const reg = a.vehicle.toUpperCase().replace(/\s+/g, '');
      const v = (await pool.query('SELECT id, reg_number FROM vehicles WHERE org_id = $1 AND reg_number = $2', [org, reg])).rows[0];
      if (!v) return { content: `No vehicle with registration ${reg}`, isError: true };
      const t = (await pool.query(
        `SELECT t.start_ts, t.end_ts, t.distance_km, t.max_speed_kmh, d.name AS driver FROM trips t LEFT JOIN drivers d ON d.id = t.driver_id
          WHERE t.vehicle_id = $1 AND t.start_ts >= now() - ($2::int * interval '1 day') ORDER BY t.start_ts DESC`, [v.id, a.days])).rows;
      return { content: cap({ vehicle: v.reg_number, days: a.days, trip_count: t.length, total_km: r1(t.reduce((s, x) => s + x.distance_km, 0)),
        trips: t.slice(0, 25).map((x) => ({ start: x.start_ts, end: x.end_ts, km: r1(x.distance_km), max_speed_kmh: r1(x.max_speed_kmh), driver: x.driver })) }) };
    }
    case 'fleet_summary': {
      const d = await buildDashboard(org, a.days);
      return { content: cap({
        days: a.days, fleet_now: d.status, utilization: { ...d.utilization, daily: undefined, top_distance: d.utilization.top_distance.slice(0, 5) },
        trips: { total: d.trips.total, km: d.trips.km, avg_km: d.trips.avg_km, avg_duration_min: d.trips.avg_duration_min, avg_speed_kmh: d.trips.avg_speed_kmh, longest: d.trips.longest, change_vs_previous_period_pct: { trips: d.trips.delta_trips_pct, km: d.trips.delta_km_pct } },
        driver_behaviour: { note: 'Derived from GPS speed changes, not an accelerometer.', fleet_score: d.behaviour.score, overspeed: d.behaviour.overspeed, harsh_braking: d.behaviour.harsh_braking, harsh_acceleration: d.behaviour.harsh_acceleration, events_per_100km: d.behaviour.events_per_100km, bands: d.behaviour.bands, drivers: d.behaviour.drivers.slice(0, 10) },
        fuel: { note: 'ESTIMATED from distance and idle time, not measured.', currency: 'INR', ...d.fuel, daily: undefined, by_vehicle: d.fuel.by_vehicle.slice(0, 5) },
      }) };
    }
    case 'list_drivers': {
      const rows = (await pool.query(
        `SELECT d.name, d.phone, d.license_number, d.license_expiry::text, d.preferred_language, d.status, string_agg(v.reg_number, ', ') AS vehicles
           FROM drivers d LEFT JOIN vehicles v ON v.driver_id = d.id
          WHERE d.org_id = $1 AND ($2::text IS NULL OR d.name ILIKE '%' || $2 || '%')
            AND ($3::int IS NULL OR (d.license_expiry IS NOT NULL AND d.license_expiry <= current_date + $3::int))
          GROUP BY d.id ORDER BY d.license_expiry NULLS LAST, d.name LIMIT 50`, [org, a.name ?? null, a.licence_expiring_days ?? null])).rows;
      return { content: cap({ count: rows.length, drivers: rows }) };
    }
    case 'device_health': {
      const rows = (await pool.query(
        `SELECT dv.imei, dv.model, v.reg_number AS vehicle, dv.last_seen FROM devices dv LEFT JOIN vehicles v ON v.id = dv.vehicle_id
          WHERE dv.org_id = $1 AND (dv.last_seen IS NULL OR dv.last_seen < now() - ($2::int * interval '1 minute')) ORDER BY dv.last_seen NULLS FIRST LIMIT 50`, [org, a.silent_minutes])).rows;
      return { content: cap({ silent_minutes: a.silent_minutes, count: rows.length, devices: rows }) };
    }
  }
  return { content: `Unknown tool: ${name}`, isError: true };
}
