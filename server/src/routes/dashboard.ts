import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { config } from '../config.js';
import { liveStatus } from '../status.js';
import { estimateFuel } from '../fuel.js';

const q = z.object({ days: z.coerce.number().int().refine((n) => [1, 7, 30, 90].includes(n), 'days must be 1, 7, 30 or 90').default(7) });
const num = (v: unknown) => Number(v ?? 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = Math.round;

/** Dashboard metrics for one org over the last `days` calendar days (org timezone). Also used by the AI assistant. */
export async function buildDashboard(org: string, days: number) {
    const tz = (await pool.query('SELECT timezone FROM organizations WHERE id = $1', [org])).rows[0]?.timezone ?? 'Asia/Kolkata';

    // Calendar days in the org's timezone, oldest first.
    const dayRows = (await pool.query(
      `SELECT g::date::text AS day FROM generate_series((now() AT TIME ZONE $1)::date - ($2::int - 1), (now() AT TIME ZONE $1)::date, interval '1 day') g ORDER BY 1`, [tz, days])).rows;
    const dayList: string[] = dayRows.map((r) => r.day);
    const first = dayList[0];
    const FROM = `($3::date::timestamp AT TIME ZONE $2)`;
    const PREV_FROM = `(($3::date - $4::int)::timestamp AT TIME ZONE $2)`;

    const [vehiclesQ, posQ, tripsVD, tripsHour, tripsBucket, longestQ, recentQ, prevQ] = await Promise.all([
      pool.query(
        `SELECT v.id, v.reg_number, v.name, v.type, v.fuel_type, v.status, v.driver_id, d.name AS driver_name, s.ts, s.speed_kmh, s.ignition
           FROM vehicles v LEFT JOIN drivers d ON d.id = v.driver_id LEFT JOIN vehicle_state s ON s.vehicle_id = v.id WHERE v.org_id = $1`, [org]),
      pool.query(
        `WITH p AS (
           SELECT vehicle_id, ts, speed_kmh, ignition,
                  lag(speed_kmh) OVER w AS pv, lag(ignition) OVER w AS pi, lag(ts) OVER w AS pts
             FROM positions WHERE org_id = $1 AND ts >= ${FROM}
           WINDOW w AS (PARTITION BY vehicle_id ORDER BY ts)
         ), x AS (
           SELECT vehicle_id, (ts AT TIME ZONE $2)::date::text AS day, speed_kmh, pv, pi,
                  EXTRACT(epoch FROM ts - pts) AS dt
             FROM p WHERE pts IS NOT NULL
         )
         SELECT vehicle_id, day,
           COALESCE(sum(dt) FILTER (WHERE dt > 0 AND dt <= 300 AND pi IS DISTINCT FROM false AND pv >= $4), 0)::float AS moving_s,
           COALESCE(sum(dt) FILTER (WHERE dt > 0 AND dt <= 300 AND pi IS TRUE AND pv < $4), 0)::float AS idle_s,
           COALESCE(sum(dt) FILTER (WHERE dt > 0 AND dt <= 300 AND NOT (pi IS DISTINCT FROM false AND pv >= $4) AND NOT (pi IS TRUE AND pv < $4)), 0)::float AS stopped_s,
           count(*) FILTER (WHERE dt BETWEEN 1 AND 15 AND (pv - speed_kmh) / dt >= $5)::int AS brakes,
           count(*) FILTER (WHERE dt BETWEEN 1 AND 15 AND (speed_kmh - pv) / dt >= $5)::int AS accels,
           count(*) FILTER (WHERE speed_kmh > $6 AND pv <= $6)::int AS overs
         FROM x GROUP BY vehicle_id, day`, [org, tz, first, config.movingSpeedKmh, config.harshKmhPerSec, config.overspeedKmh]),
      pool.query(
        `SELECT vehicle_id, (start_ts AT TIME ZONE $2)::date::text AS day, count(*)::int AS n, COALESCE(sum(distance_km),0)::float AS km,
                COALESCE(sum(EXTRACT(epoch FROM COALESCE(end_ts, now()) - start_ts)),0)::float AS dur_s, max(max_speed_kmh)::float AS max_speed
           FROM trips WHERE org_id = $1 AND start_ts >= ${FROM} GROUP BY 1, 2`, [org, tz, first]),
      pool.query(
        `SELECT EXTRACT(hour FROM start_ts AT TIME ZONE $2)::int AS h, count(*)::int AS n FROM trips WHERE org_id = $1 AND start_ts >= ${FROM} GROUP BY 1`, [org, tz, first]),
      pool.query(
        `SELECT CASE WHEN distance_km < 10 THEN 0 WHEN distance_km < 50 THEN 1 WHEN distance_km < 150 THEN 2 WHEN distance_km < 300 THEN 3 ELSE 4 END AS b, count(*)::int AS n
           FROM trips WHERE org_id = $1 AND start_ts >= ${FROM} GROUP BY 1`, [org, tz, first]),
      pool.query(
        `SELECT t.distance_km::float AS km, v.reg_number, t.start_ts FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
          WHERE t.org_id = $1 AND t.start_ts >= ${FROM} ORDER BY t.distance_km DESC LIMIT 1`, [org, tz, first]),
      pool.query(
        `SELECT t.id, v.reg_number, d.name AS driver_name, t.start_ts, t.end_ts, t.distance_km::float AS km, t.max_speed_kmh::float AS max_speed
           FROM trips t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id
          WHERE t.org_id = $1 ORDER BY t.start_ts DESC LIMIT 8`, [org]),
      pool.query(
        `SELECT count(*)::int AS n, COALESCE(sum(distance_km),0)::float AS km FROM trips
          WHERE org_id = $1 AND start_ts >= ${PREV_FROM} AND start_ts < ${FROM}`, [org, tz, first, days]),
    ]);

    // ---------- fleet status (live) ----------
    const vehicles = vehiclesQ.rows;
    const status = { total: vehicles.length, running: 0, idle: 0, stopped: 0, no_gps: 0, maintenance: 0 };
    for (const v of vehicles) {
      if (v.status === 'maintenance') status.maintenance++;
      const s = v.ts ? liveStatus(v) : 'unknown';
      if (s === 'moving') status.running++; else if (s === 'idle') status.idle++; else if (s === 'stopped') status.stopped++; else status.no_gps++;
    }

    const byId = new Map<string, any>(vehicles.map((v) => [v.id, v]));
    const activeIds = vehicles.filter((v) => v.status === 'active').map((v) => v.id as string);
    const nActive = Math.max(activeIds.length, 1);

    // ---------- per-vehicle / per-day rollups ----------
    const dayIdx = new Map(dayList.map((d, i) => [d, i]));
    const blank = () => dayList.map((day) => ({ day, trips: 0, km: 0, used: new Set<string>(), moving_s: 0, idle_s: 0, stopped_s: 0, brakes: 0, accels: 0, overs: 0, fuel_cost: 0, idle_fuel_cost: 0 }));
    const daily = blank();
    const perVeh = new Map<string, { km: number; trips: number; moving_s: number; idle_s: number; stopped_s: number; brakes: number; accels: number; overs: number; dur_s: number; max_speed: number }>();
    const pv = (id: string) => { if (!perVeh.has(id)) perVeh.set(id, { km: 0, trips: 0, moving_s: 0, idle_s: 0, stopped_s: 0, brakes: 0, accels: 0, overs: 0, dur_s: 0, max_speed: 0 }); return perVeh.get(id)!; };
    const vdKm = new Map<string, number>(), vdIdle = new Map<string, number>();

    for (const r of tripsVD.rows) {
      const d = daily[dayIdx.get(r.day) ?? -1]; if (!d) continue;
      d.trips += r.n; d.km += r.km; d.used.add(r.vehicle_id);
      const v = pv(r.vehicle_id); v.km += r.km; v.trips += r.n; v.dur_s += r.dur_s; v.max_speed = Math.max(v.max_speed, r.max_speed);
      vdKm.set(`${r.vehicle_id}|${r.day}`, r.km);
    }
    for (const r of posQ.rows) {
      const d = daily[dayIdx.get(r.day) ?? -1]; if (!d) continue;
      for (const k of ['moving_s', 'idle_s', 'stopped_s', 'brakes', 'accels', 'overs'] as const) { d[k] += r[k]; pv(r.vehicle_id)[k] += r[k]; }
      vdIdle.set(`${r.vehicle_id}|${r.day}`, r.idle_s);
    }

    // ---------- fuel (estimated) ----------
    const fuelByVeh = new Map<string, number>(), fuelByType = new Map<string, number>();
    let fuelCost = 0, idleCost = 0, liquidUnits = 0, liquidKm = 0, idleLiquidUnits = 0;
    const keys = new Set([...vdKm.keys(), ...vdIdle.keys()]);
    for (const key of keys) {
      const [vid, day] = key.split('|'); const v = byId.get(vid); if (!v) continue;
      const km = vdKm.get(key) ?? 0, idle = vdIdle.get(key) ?? 0;
      const e = estimateFuel(v.type, v.fuel_type, km, idle);
      const cost = e.driveCost + e.idleCost;
      fuelCost += cost; idleCost += e.idleCost;
      if (e.unit === 'L') { liquidUnits += e.driveUnits + e.idleUnits; liquidKm += km; idleLiquidUnits += e.idleUnits; }
      fuelByVeh.set(vid, (fuelByVeh.get(vid) ?? 0) + cost);
      fuelByType.set(v.fuel_type, (fuelByType.get(v.fuel_type) ?? 0) + cost);
      const d = daily[dayIdx.get(day) ?? -1]; if (d) { d.fuel_cost += cost; d.idle_fuel_cost += e.idleCost; }
    }

    // ---------- utilization ----------
    const used = new Set<string>(); for (const d of daily) d.used.forEach((id) => used.add(id));
    const usedActive = activeIds.filter((id) => used.has(id)).length;
    const sum = (f: (d: (typeof daily)[number]) => number) => daily.reduce((a, d) => a + f(d), 0);
    const movingS = sum((d) => d.moving_s), idleS = sum((d) => d.idle_s), stoppedS = sum((d) => d.stopped_s);
    const totalKm = sum((d) => d.km), totalTrips = sum((d) => d.trips);
    const totalDur = [...perVeh.values()].reduce((a, v) => a + v.dur_s, 0);
    const tracked = movingS + idleS + stoppedS || 1;

    const topKm = [...perVeh.entries()].map(([id, v]) => ({ id, reg: byId.get(id)?.reg_number, km: r1(v.km), trips: v.trips }))
      .filter((x) => x.reg).sort((a, b) => b.km - a.km).slice(0, 8);
    const unused = vehicles.filter((v) => v.status === 'active' && !used.has(v.id)).map((v) => ({ id: v.id, reg: v.reg_number, name: v.name })).slice(0, 8);

    // ---------- driver behaviour ----------
    const drivers = new Map<string, { id: string; name: string; km: number; brakes: number; accels: number; overs: number }>();
    for (const [vid, v] of perVeh) {
      const meta = byId.get(vid); if (!meta?.driver_id) continue;
      const d = drivers.get(meta.driver_id) ?? { id: meta.driver_id, name: meta.driver_name, km: 0, brakes: 0, accels: 0, overs: 0 };
      d.km += v.km; d.brakes += v.brakes; d.accels += v.accels; d.overs += v.overs; drivers.set(meta.driver_id, d);
    }
    const driverRows = [...drivers.values()].map((d) => {
      const ev = d.brakes + d.accels + d.overs;
      const per100 = d.km >= 5 ? (ev / d.km) * 100 : null;
      return { ...d, km: r1(d.km), events: ev, per100km: per100 === null ? null : r1(per100), score: per100 === null ? null : Math.max(0, Math.min(100, r0(100 - 4 * per100))) };
    }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const scored = driverRows.filter((d) => d.score !== null) as (typeof driverRows[number] & { score: number })[];
    const totals = { brakes: sum((d) => d.brakes), accels: sum((d) => d.accels), overs: sum((d) => d.overs) };
    const evAll = totals.brakes + totals.accels + totals.overs;
    const bands = { good: scored.filter((d) => d.score >= 85).length, fair: scored.filter((d) => d.score >= 70 && d.score < 85).length, risky: scored.filter((d) => d.score < 70).length };

    const hours = Array.from({ length: 24 }, (_, h) => tripsHour.rows.find((r) => r.h === h)?.n ?? 0);
    const buckets = ['<10 km', '10–50 km', '50–150 km', '150–300 km', '300+ km'].map((label, i) => ({ label, trips: tripsBucket.rows.find((r) => r.b === i)?.n ?? 0 }));
    const prev = prevQ.rows[0];
    const delta = (cur: number, p: number) => (p > 0 ? r1(((cur - p) / p) * 100) : null);

    return {
      meta: { days, timezone: tz, generated_at: new Date().toISOString(), overspeed_kmh: config.overspeedKmh, harsh_kmh_per_s: config.harshKmhPerSec },
      status,
      utilization: {
        pct: r1((usedActive / nActive) * 100), used_vehicles: usedActive, active_vehicles: activeIds.length,
        avg_driving_h_per_vehicle_day: r1(movingS / 3600 / nActive / days), avg_km_per_vehicle_day: r1(totalKm / nActive / days),
        idle_share_pct: r1((idleS / tracked) * 100),
        time_split_h: { moving: r1(movingS / 3600), idle: r1(idleS / 3600), stopped: r1(stoppedS / 3600) },
        daily: daily.map((d) => ({ day: d.day, pct: r1((d.used.size / nActive) * 100), vehicles: d.used.size })),
        top_distance: topKm, unused,
      },
      trips: {
        total: totalTrips, km: r1(totalKm), delta_trips_pct: delta(totalTrips, prev.n), delta_km_pct: delta(totalKm, prev.km),
        avg_km: totalTrips ? r1(totalKm / totalTrips) : 0, avg_duration_min: totalTrips ? r0(totalDur / 60 / totalTrips) : 0,
        avg_speed_kmh: totalDur ? r1(totalKm / (totalDur / 3600)) : 0,
        longest: longestQ.rows[0] ? { km: r1(longestQ.rows[0].km), reg: longestQ.rows[0].reg_number, start_ts: longestQ.rows[0].start_ts } : null,
        daily: daily.map((d) => ({ day: d.day, trips: d.trips, km: r1(d.km) })), by_hour: hours, by_distance: buckets,
        recent: recentQ.rows.map((r) => ({ ...r, km: r1(r.km) })),
      },
      behaviour: {
        score: scored.length ? r0(scored.reduce((a, d) => a + d.score, 0) / scored.length) : null,
        overspeed: totals.overs, harsh_braking: totals.brakes, harsh_acceleration: totals.accels,
        events_per_100km: totalKm >= 5 ? r1((evAll / totalKm) * 100) : null,
        daily: daily.map((d) => ({ day: d.day, overspeed: d.overs, braking: d.brakes, acceleration: d.accels })),
        bands, drivers: driverRows.slice(0, 50),
      },
      fuel: {
        estimated: true,
        cost: r0(fuelCost), litres: r0(liquidUnits), cost_per_km: totalKm ? r1(fuelCost / totalKm) : null,
        avg_km_per_litre: liquidUnits ? r1(liquidKm / liquidUnits) : null,
        idle_cost: r0(idleCost), idle_litres: r1(idleLiquidUnits), idle_share_pct: fuelCost ? r1((idleCost / fuelCost) * 100) : 0,
        daily: daily.map((d) => ({ day: d.day, cost: r0(d.fuel_cost), idle_cost: r0(d.idle_fuel_cost) })),
        by_vehicle: [...fuelByVeh.entries()].map(([id, c]) => ({ id, reg: byId.get(id)?.reg_number, cost: r0(c) })).sort((a, b) => b.cost - a.cost).slice(0, 8),
        by_fuel_type: [...fuelByType.entries()].map(([fuel, c]) => ({ fuel, cost: r0(c) })).sort((a, b) => b.cost - a.cost),
      },
    };
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', { preHandler: app.auth }, async (req) => buildDashboard(req.user.org, q.parse(req.query).days));
}
