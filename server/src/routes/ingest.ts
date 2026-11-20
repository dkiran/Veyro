import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { ingestPositions, positionSchema } from '../ingest.js';

const body = z.object({ imei: z.string(), positions: z.array(positionSchema).min(1).max(1000) });

/**
 * HTTP gateway for devices / protocol adapters. Native TCP protocols (GT06, Teltonika, AIS-140...)
 * should be decoded by a separate gateway that calls this endpoint, or ingestPositions() directly.
 */
export async function ingestRoutes(app: FastifyInstance) {
  app.post('/api/ingest', async (req, reply) => {
    const key = req.headers['x-device-key'];
    const b = body.parse(req.body);
    const r = await pool.query('SELECT id, org_id, vehicle_id, api_key FROM devices WHERE imei = $1', [b.imei]);
    const dev = r.rows[0];
    if (!dev || typeof key !== 'string' || key !== dev.api_key) return reply.code(401).send({ error: 'invalid_device_credentials' });
    return ingestPositions(dev, b.positions);
  });
}
