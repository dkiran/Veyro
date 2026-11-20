import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, tx } from '../db.js';

const signup = z.object({
  orgName: z.string().min(2), name: z.string().min(1),
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(8),
  locale: z.string().default('en'),
});
const login = z.object({ email: z.string().email().transform((s) => s.toLowerCase()), password: z.string() });

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/signup', async (req, reply) => {
    const b = signup.parse(req.body);
    const hash = await bcrypt.hash(b.password, 10);
    const user = await tx(async (c) => {
      const org = await c.query('INSERT INTO organizations(name) VALUES ($1) RETURNING id', [b.orgName]);
      return (await c.query(
        `INSERT INTO users(org_id,email,password_hash,name,role,locale) VALUES ($1,$2,$3,$4,'admin',$5)
         RETURNING id, org_id, name, email, role, locale`,
        [org.rows[0].id, b.email, hash, b.name, b.locale])).rows[0];
    });
    const token = app.jwt.sign({ uid: user.id, org: user.org_id, role: user.role });
    reply.code(201).send({ token, user });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const b = login.parse(req.body);
    const r = await pool.query('SELECT * FROM users WHERE email = $1', [b.email]);
    const u = r.rows[0];
    // Always run a hash comparison to keep timing similar for unknown emails.
    const ok = await bcrypt.compare(b.password, u?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    if (!u || !ok) return reply.code(401).send({ error: 'invalid_credentials' });
    const token = app.jwt.sign({ uid: u.id, org: u.org_id, role: u.role });
    return { token, user: { id: u.id, org_id: u.org_id, name: u.name, email: u.email, role: u.role, locale: u.locale } };
  });

  app.get('/api/auth/me', { preHandler: app.auth }, async (req) => {
    const r = await pool.query('SELECT id, org_id, name, email, role, locale FROM users WHERE id = $1', [req.user.uid]);
    return r.rows[0];
  });

  app.patch('/api/auth/me', { preHandler: app.auth }, async (req) => {
    const b = z.object({ locale: z.string().min(2).max(16) }).parse(req.body);
    await pool.query('UPDATE users SET locale = $1 WHERE id = $2', [b.locale, req.user.uid]);
    return { ok: true };
  });
}
