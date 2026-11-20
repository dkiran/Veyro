import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';

const range = z.object({
  from: z.coerce.date(), to: z.coerce.date(),
  maxPoints: z.coerce.number().int().min(10).max(20000).default(5000),
});

export async function historyRoutes(app: FastifyInstance) {
  async function ownVehicle(org: string, id: string) {
    const r = await pool.query('SELECT id, reg_number FROM vehicles WHERE id = $1 AND org_id = $2', [id, org]);
    return r.rows[0];
  }

  // GPS breadcrumb for a vehicle, evenly downsampled to at most maxPoints (always keeps first/last).
  app.get('/api/vehicles/:id/history', { preHandler: app.auth }, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as any).id);
    const q = range.parse(req.query);
    if (q.to <= q.from) return reply.code(400).send({ error: 'invalid_range' });
    if (!(await ownVehicle(req.user.org, id))) return reply.code(404).send({ error: 'not_found' });
    const r = await pool.query(
      `WITH p AS (
         SELECT ts, lat, lng, speed_kmh, heading, ignition,
                row_number() OVER (ORDER BY ts) AS rn, count(*) OVER () AS total
           FROM positions WHERE vehicle_id = $1 AND ts >= $2 AND ts <= $3)
       SELECT ts, lat, lng, speed_kmh, heading, ignition, total FROM p
        WHERE total <= $4 OR rn = 1 OR rn = total OR (rn - 1) % ceil(total::float / $4)::int = 0
        ORDER BY ts`, [id, q.from, q.to, q.maxPoints]);
    const total = r.rows[0] ? Number(r.rows[0].total) : 0;
    return { total, returned: r.rows.length, points: r.rows.map(({ total: _t, ...p }) => p) };
  });

  app.get('/api/vehicles/:id/trips', { preHandler: app.auth }, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as any).id);
    const q = range.parse(req.query);
    if (!(await ownVehicle(req.user.org, id))) return reply.code(404).send({ error: 'not_found' });
    const r = await pool.query(
      `SELECT t.*, d.name AS driver_name FROM trips t LEFT JOIN drivers d ON d.id = t.driver_id
        WHERE t.vehicle_id = $1 AND t.start_ts <= $3 AND COALESCE(t.end_ts, now()) >= $2 ORDER BY t.start_ts DESC`,
      [id, q.from, q.to]);
    return r.rows;
  });
}
