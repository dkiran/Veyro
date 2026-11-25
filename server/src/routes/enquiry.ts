import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { config } from '../config.js';
import { mailConfigured, sendZeptoMail, type Mailer } from '../mail.js';

// Public endpoint for the website's contact form (veyrotrack.com). No login.
// The website's web server forwards same-origin POST /api/demo here, so no CORS is needed.
// Every enquiry is saved first; the email to the sales inbox is sent afterwards and its outcome recorded,
// so a lead is never lost because of an email problem.

const INTERESTS = { pilot: '30-day pilot', demo: 'Demo', partner: 'AI for GPS platform (partner)', hub: 'GPS data hub', other: 'Other' } as const;
const line = (max: number) => z.string().trim().max(max).transform((s) => s.replace(/[\r\n\t]+/g, ' '));

const body = z.object({
  interest: z.string().optional().transform((v) => (v && v in INTERESTS ? (v as keyof typeof INTERESTS) : 'demo')),
  name: line(100).pipe(z.string().min(1)),
  company: line(120).pipe(z.string().min(1)),
  email: line(160).pipe(z.string().email()),
  phone: line(30).pipe(z.string().min(3)),
  fleetSize: line(20).optional(),
  industry: line(60).optional(),
  message: z.string().trim().max(2000).optional(),
  website: z.string().optional(), // honeypot: real visitors never fill it
});

// Simple per-IP limit (in-memory; use Redis if you run several API instances).
const hits = new Map<string, number[]>();
const LIMIT = 5, WINDOW_MS = 60 * 60_000;
function limited(ip: string) {
  const now = Date.now(), arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return arr.length > LIMIT;
}

// Behind Caddy -> nginx, the visitor's address is the last entry Caddy appended to X-Forwarded-For.
function clientIp(req: any): string {
  const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return (xff[xff.length - 1] ?? req.ip ?? '').slice(0, 64);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function enquiryRoutes(app: FastifyInstance, opts: { mailer?: Mailer } = {}) {
  const mailer = opts.mailer ?? sendZeptoMail;
  const canMail = () => Boolean(opts.mailer) || mailConfigured();

  async function notify(id: string, e: z.infer<typeof body>) {
      const fields: [string, string][] = [
        ['Interested in', INTERESTS[e.interest]], ['Name', e.name], ['Company', e.company], ['Email', e.email], ['Phone', e.phone],
        ['Fleet size', e.fleetSize ?? ''], ['Industry', e.industry ?? ''], ['Message', e.message ?? ''], ['Enquiry no.', String(id)],
      ];
      try {
        await mailer({
          to: config.mail.to,
          subject: `New website enquiry (${INTERESTS[e.interest]}): ${e.company} (${e.fleetSize || 'fleet size n/a'})`,
          text: fields.map(([k, v]) => `${k}: ${v}`).join('\n'),
          html: `<h2>New enquiry from veyrotrack.com</h2><table cellpadding="6" style="border-collapse:collapse">${fields
            .map(([k, v]) => `<tr><td style="border:1px solid #ddd"><b>${esc(k)}</b></td><td style="border:1px solid #ddd">${esc(v).replace(/\n/g, '<br>')}</td></tr>`)
            .join('')}</table>`,
          replyTo: { address: e.email, name: e.name },
        });
        await pool.query(`UPDATE website_enquiries SET mail_status = 'sent' WHERE id = $1`, [id]);
      } catch (err: any) {
        app.log.error({ err: err?.message, enquiry: id }, 'enquiry email failed');
        await pool.query(`UPDATE website_enquiries SET mail_status = 'failed', mail_error = $2 WHERE id = $1`, [id, String(err?.message ?? err).slice(0, 500)]);
      }
    }

  app.post('/api/public/enquiry', { bodyLimit: 32 * 1024 }, async (req, reply) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    if (typeof raw.website === 'string' && raw.website.trim()) return { ok: true }; // bot: pretend success, store nothing
    const ip = clientIp(req);
    if (limited(ip)) return reply.code(429).send({ error: 'rate_limited' });
    const e = body.parse(raw);

    const { rows } = await pool.query(
      `INSERT INTO website_enquiries (interest, name, company, email, phone, fleet_size, industry, message, ip, mail_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, created_at`,
      [INTERESTS[e.interest], e.name, e.company, e.email, e.phone, e.fleetSize || null, e.industry || null, e.message || null, ip, canMail() ? 'pending' : 'not_configured'],
    );
    const id = rows[0].id as string;

    // Answer the visitor straight away; the email is sent in the background and its outcome recorded.
    if (canMail() && config.mail.to.length) void notify(id, e);
    return reply.code(201).send({ ok: true });
  });
}
