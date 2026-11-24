import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';

const q = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
  vehicle_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function tripRoutes(app: FastifyInstance) {
  app.get('/api/trips', { preHandler: app.auth }, async (req) => {
    const f = q.parse(req.query);
    const where = `t.org_id = $1 AND t.start_ts >= now() - ($2::int * interval '1 day') AND ($3::uuid IS NULL OR t.vehicle_id = $3)`;
    const params = [req.user.org, f.days, f.vehicle_id ?? null];
    const [rows, agg] = await Promise.all([
      pool.query(
        `SELECT t.id, t.vehicle_id, v.reg_number, v.name AS vehicle_name, d.name AS driver_name, t.start_ts, t.end_ts, t.start_lat, t.start_lng, t.end_lat, t.end_lng,
                t.distance_km::float, t.max_speed_kmh::float,
                CASE WHEN COALESCE(t.end_ts, now()) > t.start_ts THEN t.distance_km / (EXTRACT(epoch FROM COALESCE(t.end_ts, now()) - t.start_ts) / 3600) END::float AS avg_speed_kmh
           FROM trips t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id
          WHERE ${where} ORDER BY t.start_ts DESC LIMIT $4 OFFSET $5`, [...params, f.limit, f.offset]),
      pool.query(`SELECT count(*)::int AS n, COALESCE(sum(t.distance_km),0)::float AS km FROM trips t WHERE ${where}`, params),
    ]);
    return { total: agg.rows[0].n, total_km: agg.rows[0].km, rows: rows.rows };
  });
}
