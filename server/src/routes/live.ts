import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { join, leave } from '../hub.js';
import { liveStatus } from '../status.js';

export async function liveRoutes(app: FastifyInstance) {
  app.get('/api/live/snapshot', { preHandler: app.auth }, async (req) => {
    const r = await pool.query(
      `SELECT v.id AS vehicle_id, v.reg_number, v.name, v.type, d.name AS driver_name,
              s.ts, s.lat, s.lng, s.speed_kmh, s.heading, s.ignition, s.odometer_km
         FROM vehicles v JOIN vehicle_state s ON s.vehicle_id = v.id
         LEFT JOIN drivers d ON d.id = v.driver_id
        WHERE v.org_id = $1 AND v.status <> 'inactive'`, [req.user.org]);
    return r.rows.map((row) => ({ ...row, status: liveStatus(row) }));
  });

  // Browsers can't set headers on WebSockets, so the JWT comes via ?token=.
  app.get('/api/live/ws', { websocket: true }, (socket, req) => {
    let user;
    try { user = app.jwt.verify<{ org: string }>(String((req.query as any).token ?? '')); }
    catch { socket.close(4401, 'unauthorized'); return; }
    join(user.org, socket);
    const ping = setInterval(() => socket.readyState === 1 && socket.ping(), 30_000);
    socket.on('close', () => { clearInterval(ping); leave(user.org, socket); });
  });
}
