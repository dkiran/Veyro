import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.ZEPTOMAIL_TOKEN = 'abc123';
process.env.MAIL_FROM = 'noreply@veyrotrack.com';
const { sendZeptoMail, mailConfigured } = await import('../src/mail.js');

test('sends the ZeptoMail API request in the documented shape', async () => {
  assert.equal(mailConfigured(), true);
  const calls: { url: string; init: any }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response('{"data":[]}', { status: 201 }); }) as any;
  try {
    await sendZeptoMail({ to: ['sales@veyrotrack.com'], subject: 'Hi', html: '<b>x</b>', text: 'x', replyTo: { address: 'a@b.co', name: 'A' } });
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls[0].url, 'https://api.zeptomail.in/v1.1/email');
  assert.equal(calls[0].init.headers.authorization, 'Zoho-enczapikey abc123');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.from, { address: 'noreply@veyrotrack.com', name: 'Veyro Website' });
  assert.deepEqual(body.to, [{ email_address: { address: 'sales@veyrotrack.com' } }]);
  assert.deepEqual(body.reply_to, [{ address: 'a@b.co', name: 'A' }]);
  assert.equal(body.htmlbody, '<b>x</b>');
  assert.equal(body.textbody, 'x');
});

test('reports ZeptoMail errors', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"error":{"code":"TM_4001"}}', { status: 401 })) as any;
  try {
    await assert.rejects(sendZeptoMail({ to: ['x@y.co'], subject: 's', html: 'h', text: 't' }), /zeptomail_http_401/);
  } finally { globalThis.fetch = realFetch; }
});
