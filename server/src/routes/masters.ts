import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';

const uuid = z.string().uuid();
const optStr = z.string().trim().min(1).nullish().transform((v) => v ?? null);

const driver = z.object({
  name: z.string().trim().min(1), phone: optStr, license_number: optStr,
  license_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? null),
  preferred_language: z.string().default('en'),
  status: z.enum(['active', 'inactive']).default('active'),
});
const vehicle = z.object({
  reg_number: z.string().trim().min(3).transform((s) => s.toUpperCase().replace(/\s+/g, '')),
  name: optStr,
  type: z.enum(['car', 'truck', 'bus', 'van', 'bike', 'tractor', 'other']).default('truck'),
  make: optStr, model: optStr, year: z.number().int().min(1950).max(2100).nullish().transform((v) => v ?? null),
  fuel_type: z.enum(['diesel', 'petrol', 'cng', 'electric', 'hybrid', 'other']).default('diesel'),
  driver_id: uuid.nullish().transform((v) => v ?? null),
  status: z.enum(['active', 'inactive', 'maintenance']).default('active'),
});
const device = z.object({
  imei: z.string().trim().regex(/^\d{10,20}$/, 'IMEI must be 10-20 digits'),
  model: optStr, protocol: z.string().default('http-json'), sim_number: optStr,
  vehicle_id: uuid.nullish().transform((v) => v ?? null),
});

type Def = { table: string; schema: z.ZodObject<any>; select: string; from?: string; order: string };
const defs: Record<string, Def> = {
  drivers: { table: 'drivers', schema: driver, select: 't.*', order: 't.name' },
  vehicles: {
    table: 'vehicles', schema: vehicle, order: 't.reg_number',
    select: `t.*, d.name AS driver_name, dv.imei AS device_imei,
      s.ts AS last_ts, s.lat, s.lng, s.speed_kmh, s.heading, s.ignition, s.odometer_km`,
    from: `LEFT JOIN drivers d ON d.id = t.driver_id
           LEFT JOIN devices dv ON dv.vehicle_id = t.id
           LEFT JOIN vehicle_state s ON s.vehicle_id = t.id`,
  },
  devices: {
    table: 'devices', schema: device, order: 't.imei',
    select: 't.*, v.reg_number AS vehicle_reg', from: 'LEFT JOIN vehicles v ON v.id = t.vehicle_id',
  },
};

export async function masterRoutes(app: FastifyInstance) {
  for (const [path, d] of Object.entries(defs)) {
    const cols = Object.keys(d.schema.shape);
    const base = `/api/${path}`;
    const fetchOne = async (org: string, id: string) =>
      (await pool.query(`SELECT ${d.select} FROM ${d.table} t ${d.from ?? ''} WHERE t.org_id = $1 AND t.id = $2`, [org, id])).rows[0];

    app.get(base, { preHandler: app.auth }, async (req) =>
      (await pool.query(`SELECT ${d.select} FROM ${d.table} t ${d.from ?? ''} WHERE t.org_id = $1 ORDER BY ${d.order}`, [req.user.org])).rows);

    app.get(`${base}/:id`, { preHandler: app.auth }, async (req, reply) => {
      const row = await fetchOne(req.user.org, uuid.parse((req.params as any).id));
      return row ?? reply.code(404).send({ error: 'not_found' });
    });

    app.post(base, { preHandler: app.adminOnly }, async (req, reply) => {
      const b = d.schema.parse(req.body) as Record<string, unknown>;
      await assertOwned(req.user.org, b);
      const ph = cols.map((_, i) => `$${i + 2}`).join(',');
      const r = await pool.query(`INSERT INTO ${d.table}(org_id,${cols.join(',')}) VALUES ($1,${ph}) RETURNING id`, [req.user.org, ...cols.map((c) => b[c])]);
      reply.code(201).send(await fetchOne(req.user.org, r.rows[0].id));
    });

    app.put(`${base}/:id`, { preHandler: app.adminOnly }, async (req, reply) => {
      const id = uuid.parse((req.params as any).id);
      const b = d.schema.parse(req.body) as Record<string, unknown>;
      await assertOwned(req.user.org, b);
      const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(',');
      const r = await pool.query(`UPDATE ${d.table} SET ${sets} WHERE org_id = $1 AND id = $2`, [req.user.org, id, ...cols.map((c) => b[c])]);
      if (!r.rowCount) return reply.code(404).send({ error: 'not_found' });
      return fetchOne(req.user.org, id);
    });

    app.delete(`${base}/:id`, { preHandler: app.adminOnly }, async (req, reply) => {
      const r = await pool.query(`DELETE FROM ${d.table} WHERE org_id = $1 AND id = $2`, [req.user.org, uuid.parse((req.params as any).id)]);
      if (!r.rowCount) return reply.code(404).send({ error: 'not_found' });
      reply.code(204).send();
    });
  }
}

/** Foreign keys must point at rows in the caller's own org (tenant isolation). */
async function assertOwned(org: string, b: Record<string, unknown>) {
  const checks: [string, unknown][] = [['drivers', b.driver_id], ['vehicles', b.vehicle_id]];
  for (const [table, id] of checks) {
    if (!id) continue;
    const r = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1 AND org_id = $2`, [id, org]);
    if (!r.rowCount) throw Object.assign(new Error(`${table.slice(0, -1)}_not_found`), { statusCode: 400 });
  }
}
