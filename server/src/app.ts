import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { masterRoutes } from './routes/masters.js';
import { liveRoutes } from './routes/live.js';
import { historyRoutes } from './routes/history.js';
import { ingestRoutes } from './routes/ingest.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { assistantRoutes } from './routes/assistant.js';
import { tripRoutes } from './routes/trips.js';
import type { AiClient } from './assistant/chat.js';

export interface AuthUser { uid: string; org: string; role: 'admin' | 'manager' | 'viewer' }
declare module '@fastify/jwt' {
  interface FastifyJWT { payload: AuthUser; user: AuthUser }
}
declare module 'fastify' {
  interface FastifyInstance { auth: (req: any, reply: any) => Promise<void>; adminOnly: (req: any, reply: any) => Promise<void> }
}

export async function buildApp(opts: { aiClient?: () => AiClient } = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(cors, { origin: config.corsOrigin });
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '12h' } });
  await app.register(websocket);

  app.decorate('auth', async (req, reply) => {
    try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'unauthorized' }); }
  });
  app.decorate('adminOnly', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'unauthorized' }); }
    if (req.user.role === 'viewer') reply.code(403).send({ error: 'forbidden' });
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'validation', issues: err.issues });
    if (err.code === '23505') return reply.code(409).send({ error: 'duplicate', detail: err.detail });
    if (err.code === '23503') return reply.code(409).send({ error: 'in_use', detail: err.detail });
    if (err.code === '22P02') return reply.code(400).send({ error: 'invalid_id' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    reply.code(500).send({ error: 'internal' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(masterRoutes);
  await app.register(liveRoutes);
  await app.register(historyRoutes);
  await app.register(ingestRoutes);
  await app.register(dashboardRoutes);
  await app.register(tripRoutes);
  await app.register(assistantRoutes, { client: opts.aiClient });
  return app;
}
