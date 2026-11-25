import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.ENQUIRY_MAIL_TO = 'sales@example.com';
const { buildApp } = await import('../src/app.js');
const { migrate } = await import('../src/migrate.js');
const { pool } = await import('../src/db.js');
import type { MailMessage } from '../src/mail.js';

const sent: MailMessage[] = [];
let failNext = false;
let app: Awaited<ReturnType<typeof buildApp>>;
before(async () => {
  await migrate();
  app = await buildApp({ mailer: async (m) => { if (failNext) { failNext = false; throw new Error('boom'); } sent.push(m); } });
});
after(async () => { await app.close(); await pool.end(); });

let n = 0;
const ip = () => `203.0.113.${++n}`;
const settled = async (company: string) => {
  for (let i = 0; i < 50; i++) {
    const r = (await pool.query('SELECT * FROM website_enquiries WHERE company = $1', [company])).rows[0];
    if (r && r.mail_status !== 'pending') return r;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error('email not settled');
};
const post = (payload: any, from = ip()) => app.inject({ method: 'POST', url: '/api/public/enquiry', headers: { 'x-forwarded-for': `10.0.0.9, ${from}` }, payload });
const valid = (extra: any = {}) => ({ interest: 'pilot', name: 'Asha Rao', company: `Acme ${Math.random()}`, email: 'asha@example.com', phone: '+91 90000 00000', fleetSize: '11–50', industry: 'Construction', message: 'Two tippers\nplease', ...extra });

test('saves the enquiry and emails the sales inbox', async () => {
  const body = valid();
  const r = await post(body, '198.51.100.7');
  assert.equal(r.statusCode, 201);
  const row = await settled(body.company);
  assert.equal(row.interest, '30-day pilot');
  assert.equal(row.ip, '198.51.100.7');
  assert.equal(row.mail_status, 'sent');
  const m = sent.at(-1)!;
  assert.deepEqual(m.to, ['sales@example.com']);
  assert.match(m.subject, /30-day pilot/);
  assert.match(m.subject, /11–50/);
  assert.deepEqual(m.replyTo, { address: 'asha@example.com', name: 'Asha Rao' });
  assert.match(m.text, /Message: Two tippers\nplease/);
});

test('escapes HTML in the email', async () => {
  const x = valid({ name: '<script>x</script>' });
  await post(x);
  await settled(x.company);
  assert.ok(!sent.at(-1)!.html.includes('<script>'));
});

test('honeypot: pretends success, stores nothing', async () => {
  const body = valid({ website: 'http://spam.example' });
  const r = await post(body);
  assert.equal(r.statusCode, 200);
  assert.equal((await pool.query('SELECT 1 FROM website_enquiries WHERE company = $1', [body.company])).rowCount, 0);
});

test('rejects invalid input', async () => {
  assert.equal((await post(valid({ email: 'not-an-email' }))).statusCode, 400);
  assert.equal((await post(valid({ name: '' }))).statusCode, 400);
});

test('unknown interest falls back to Demo', async () => {
  const body = valid({ interest: 'nonsense' });
  await post(body);
  assert.equal((await pool.query('SELECT interest FROM website_enquiries WHERE company = $1', [body.company])).rows[0].interest, 'Demo');
});

test('email failure keeps the lead and records the error', async () => {
  failNext = true;
  const body = valid();
  assert.equal((await post(body)).statusCode, 201);
  const row = await settled(body.company);
  assert.equal(row.mail_status, 'failed');
  assert.match(row.mail_error, /boom/);
});

test('rate limits each visitor to 5 enquiries an hour', async () => {
  const from = '192.0.2.55';
  for (let i = 0; i < 5; i++) assert.equal((await post(valid(), from)).statusCode, 201);
  assert.equal((await post(valid(), from)).statusCode, 429);
});
