import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { pool } from '../db.js';
import { aiConfigured, runChat, type AiClient } from '../assistant/chat.js';

const body = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) })).min(1).max(30),
});

// Simple per-user limit (in-memory; use Redis if you run several API instances).
const hits = new Map<string, number[]>();
const LIMIT = 20, WINDOW_MS = 60_000;
function limited(uid: string) {
  const now = Date.now(), arr = (hits.get(uid) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now); hits.set(uid, arr);
  return arr.length > LIMIT;
}

export async function assistantRoutes(app: FastifyInstance, opts: { client?: () => AiClient } = {}) {
  app.get('/api/assistant/status', { preHandler: app.auth }, async () => ({ enabled: opts.client ? true : aiConfigured() }));

  app.post('/api/assistant/chat', { preHandler: app.auth }, async (req, reply) => {
    const b = body.parse(req.body);
    if (b.messages[b.messages.length - 1].role !== 'user') return reply.code(400).send({ error: 'last_message_must_be_user' });
    if (limited(req.user.uid)) return reply.code(429).send({ error: 'rate_limited' });

    // Server-sent events. We bypass Fastify's reply handling, so set CORS ourselves.
    reply.hijack();
    const res = reply.raw;
    const origin = req.headers.origin;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no',
      ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    });
    const send = (e: unknown) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };

    if (!opts.client && !aiConfigured()) {
      send({ type: 'error', code: 'not_configured', message: 'The AI assistant is not set up yet. An administrator needs to set ANTHROPIC_API_KEY on the server.' });
      return res.end();
    }
    const ac = new AbortController();
    res.on('close', () => ac.abort()); // user closed the chat / navigated away
    try {
      const org = (await pool.query('SELECT name, timezone FROM organizations WHERE id = $1', [req.user.org])).rows[0];
      await runChat({
        client: opts.client ? opts.client() : (new Anthropic() as AiClient), org: req.user.org, orgName: org?.name ?? 'this company', timezone: org?.timezone ?? 'Asia/Kolkata',
        messages: b.messages, emit: send, signal: ac.signal,
      });
    } catch (err) {
      app.log.error(err);
      send({ type: 'error', code: 'internal', message: 'Something went wrong.' });
    } finally { res.end(); }
  });
}
