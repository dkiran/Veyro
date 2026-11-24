import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { buildApp } = await import('../src/app.js');
const { migrate } = await import('../src/migrate.js');
const { pool } = await import('../src/db.js');

let app: Awaited<ReturnType<typeof buildApp>>;
before(async () => { await migrate(); app = await buildApp(); });
after(async () => { await app.close(); await pool.end(); });

const uniq = () => Math.random().toString(36).slice(2, 10);
async function signup() {
  const r = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { orgName: 'T Org', name: 'T', email: `${uniq()}@t.io`, password: 'password123' } });
  assert.equal(r.statusCode, 201);
  return { authorization: `Bearer ${r.json().token}` };
}
const j = (h: any, method: any, url: string, payload?: any) => app.inject({ method, url, headers: h, payload });
const imeiOf = () => String(Math.floor(1e14 + Math.random() * 9e14));

test('requires auth', async () => {
  assert.equal((await app.inject({ url: '/api/vehicles' })).statusCode, 401);
});

test('masters CRUD + validation + duplicates', async () => {
  const h = await signup();
  const drv = (await j(h, 'POST', '/api/drivers', { name: 'Asha' })).json();
  const bad = await j(h, 'POST', '/api/vehicles', { reg_number: 'x' });
  assert.equal(bad.statusCode, 400);
  const v = await j(h, 'POST', '/api/vehicles', { reg_number: 'mh 12 ab 1234', driver_id: drv.id });
  assert.equal(v.statusCode, 201);
  assert.equal(v.json().reg_number, 'MH12AB1234');
  assert.equal(v.json().driver_name, 'Asha');
  assert.equal((await j(h, 'POST', '/api/vehicles', { reg_number: 'MH12AB1234' })).statusCode, 409);
  const upd = await j(h, 'PUT', `/api/vehicles/${v.json().id}`, { reg_number: 'MH12AB1234', type: 'bus' });
  assert.equal(upd.json().type, 'bus');
  assert.equal((await j(h, 'DELETE', `/api/vehicles/${v.json().id}`)).statusCode, 204);
});

test('tenant isolation', async () => {
  const a = await signup(), b = await signup();
  const v = (await j(a, 'POST', '/api/vehicles', { reg_number: 'AA11BB2222' })).json();
  assert.equal((await j(b, 'GET', `/api/vehicles/${v.id}`)).statusCode, 404);
  assert.equal((await j(b, 'DELETE', `/api/vehicles/${v.id}`)).statusCode, 404);
  assert.equal((await j(b, 'POST', '/api/devices', { imei: imeiOf(), vehicle_id: v.id })).statusCode, 400);
  assert.equal((await j(b, 'GET', `/api/vehicles/${v.id}/history?from=2020-01-01&to=2030-01-01`)).statusCode, 404);
});

test('ingest -> live state, history, trip lifecycle, dedupe, auth', async () => {
  const h = await signup();
  const v = (await j(h, 'POST', '/api/vehicles', { reg_number: 'TR11AA0001' })).json();
  const d = (await j(h, 'POST', '/api/devices', { imei: imeiOf(), vehicle_id: v.id })).json();
  const dh = { 'x-device-key': d.api_key };
  const t0 = Date.now() - 3600_000;
  const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
  const positions = [
    { ts: at(0), lat: 19.0, lng: 72.8, speed_kmh: 0, ignition: true },
    { ts: at(1), lat: 19.0, lng: 72.81, speed_kmh: 50, ignition: true },
    { ts: at(2), lat: 19.0, lng: 72.82, speed_kmh: 55, ignition: true },
    { ts: at(3), lat: 19.0, lng: 72.82, speed_kmh: 0, ignition: true },
    { ts: at(9), lat: 19.0, lng: 72.82, speed_kmh: 0, ignition: true }, // idle > 5 min -> trip ends
  ];
  const bad = await app.inject({ method: 'POST', url: '/api/ingest', headers: { 'x-device-key': 'nope' }, payload: { imei: d.imei, positions } });
  assert.equal(bad.statusCode, 401);
  const ok = await app.inject({ method: 'POST', url: '/api/ingest', headers: dh, payload: { imei: d.imei, positions } });
  assert.equal(ok.json().accepted, 5);
  const dup = await app.inject({ method: 'POST', url: '/api/ingest', headers: dh, payload: { imei: d.imei, positions } });
  assert.equal(dup.json().accepted, 0);

  const range = `from=${encodeURIComponent(at(-5))}&to=${encodeURIComponent(at(30))}`;
  const hist = (await j(h, 'GET', `/api/vehicles/${v.id}/history?${range}`)).json();
  assert.equal(hist.total, 5);
  const trips = (await j(h, 'GET', `/api/vehicles/${v.id}/trips?${range}`)).json();
  assert.equal(trips.length, 1);
  assert.ok(trips[0].end_ts, 'trip closed after idle');
  assert.ok(trips[0].distance_km > 2.0 && trips[0].distance_km < 2.3, `distance ${trips[0].distance_km}`);
  assert.equal(Math.round(trips[0].max_speed_kmh), 55);

  const snap = (await j(h, 'GET', '/api/live/snapshot')).json();
  assert.equal(snap.length, 1);
  assert.equal(snap[0].status, 'offline'); // last fix was ~50 min ago

  // unassigned device is not accepted
  const d2 = (await j(h, 'POST', '/api/devices', { imei: imeiOf() })).json();
  const un = await app.inject({ method: 'POST', url: '/api/ingest', headers: { 'x-device-key': d2.api_key }, payload: { imei: d2.imei, positions: [positions[0]] } });
  assert.equal(un.json().accepted, 0);
});

test('history downsampling keeps first and last', async () => {
  const h = await signup();
  const v = (await j(h, 'POST', '/api/vehicles', { reg_number: 'DS11AA0001' })).json();
  const d = (await j(h, 'POST', '/api/devices', { imei: imeiOf(), vehicle_id: v.id })).json();
  const t0 = Date.now() - 7200_000;
  const positions = Array.from({ length: 300 }, (_, i) => ({ ts: new Date(t0 + i * 10_000).toISOString(), lat: 12 + i * 1e-4, lng: 77, speed_kmh: 40 }));
  await app.inject({ method: 'POST', url: '/api/ingest', headers: { 'x-device-key': d.api_key }, payload: { imei: d.imei, positions } });
  const r = (await j(h, 'GET', `/api/vehicles/${v.id}/history?from=${new Date(t0 - 1000).toISOString()}&to=${new Date().toISOString()}&maxPoints=50`)).json();
  assert.equal(r.total, 300);
  assert.ok(r.returned <= 52 && r.returned >= 25, `returned ${r.returned}`);
  assert.equal(r.points[0].lat, 12);
  assert.ok(Math.abs(r.points.at(-1).lat - (12 + 299e-4)) < 1e-9);
});

test('dashboard: status, trips, behaviour events, fuel, tenant scoping', async () => {
  const h = await signup();
  const drv = (await j(h, 'POST', '/api/drivers', { name: 'Test Driver' })).json();
  const v = (await j(h, 'POST', '/api/vehicles', { reg_number: 'DB11AA0001', type: 'truck', driver_id: drv.id })).json();
  const d = (await j(h, 'POST', '/api/devices', { imei: imeiOf(), vehicle_id: v.id })).json();
  await j(h, 'POST', '/api/vehicles', { reg_number: 'DB11AA0002' }); // never reports -> "no GPS"

  // fixes 3 s apart: one overspeed (70->90), one harsh brake (90->30), one harsh accel (30->60)
  const speeds = [0, 20, 40, 60, 70, 90, 90, 30, 30, 60, 60];
  const t0 = Date.now() - 30 * 60_000;
  const positions = speeds.map((s, i) => ({ ts: new Date(t0 + i * 3000).toISOString(), lat: 19 + i * 0.0008, lng: 72.8, speed_kmh: s, ignition: true }));
  await app.inject({ method: 'POST', url: '/api/ingest', headers: { 'x-device-key': d.api_key }, payload: { imei: d.imei, positions } });

  const r = (await j(h, 'GET', '/api/dashboard?days=7')).json();
  assert.equal(r.status.total, 2);
  assert.equal(r.status.no_gps, 2); // reporting vehicle's last fix is 30 min old -> offline; other never reported
  assert.equal(r.behaviour.overspeed, 1);
  assert.equal(r.behaviour.harsh_braking, 1);
  assert.equal(r.behaviour.harsh_acceleration, 1);
  assert.equal(r.trips.total, 1);
  assert.ok(r.trips.km > 0.3);
  assert.ok(r.fuel.estimated && r.fuel.cost > 0);
  assert.equal(r.utilization.daily.length, 7);
  assert.equal(r.utilization.used_vehicles, 1);
  assert.equal(r.behaviour.drivers[0].name, 'Test Driver');

  // another tenant sees nothing of this
  const other = (await j(await signup(), 'GET', '/api/dashboard?days=7')).json();
  assert.equal(other.trips.total, 0);
  assert.equal(other.status.total, 0);
  assert.equal((await j(h, 'GET', '/api/dashboard?days=5')).statusCode, 400);
});

// ---------- assistant ----------
function fakeClient(script: Array<(params: any) => any>) {
  let i = 0; const seen: any[] = [];
  const client: any = { beta: { messages: { stream(params: any) {
    seen.push(structuredClone(params));
    const msg = script[i++](params); const h: Record<string, (t: string) => void> = {};
    return { on(ev: string, cb: any) { h[ev] = cb; return this; }, abort() {}, async finalMessage() { for (const b of msg.content) if (b.type === 'text') h.text?.(b.text); return msg; } };
  } } } };
  return { client, seen };
}
const sse = (payload: string) => payload.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));

test('assistant: not configured -> clear error event; requires auth', async () => {
  const saved = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    const h = await signup();
    assert.equal((await app.inject({ method: 'POST', url: '/api/assistant/chat', payload: { messages: [{ role: 'user', content: 'hi' }] } })).statusCode, 401);
    assert.equal((await j(h, 'GET', '/api/assistant/status')).json().enabled, false);
    const r = await j(h, 'POST', '/api/assistant/chat', { messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(sse(r.payload)[0].code, 'not_configured');
    assert.equal((await j(h, 'POST', '/api/assistant/chat', { messages: [{ role: 'assistant', content: 'x' }] })).statusCode, 400);
  } finally { if (saved) process.env.ANTHROPIC_API_KEY = saved; }
});

test('assistant: streams text, runs tools scoped to the caller\'s org, loops until end_turn', async () => {
  const a = await signup(), b = await signup();
  await j(a, 'POST', '/api/vehicles', { reg_number: 'AI11AA0001' });
  let seenByModel = '';
  const { client, seen } = fakeClient([
    () => ({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'Checking… ' }, { type: 'tool_use', id: 'tu_1', name: 'fleet_status', input: {} }, { type: 'tool_use', id: 'tu_2', name: 'find_vehicle', input: { query: 'AI11' } }] }),
    (p) => { seenByModel = JSON.stringify(p.messages.at(-1)); return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] }; },
  ]);
  const app2 = await buildApp({ aiClient: () => client });
  const call = (h: any) => app2.inject({ method: 'POST', url: '/api/assistant/chat', headers: h, payload: { messages: [{ role: 'user', content: 'where is AI11AA0001?' }] } });

  const ra = sse((await call(a)).payload);
  assert.deepEqual(ra.filter((e) => e.type === 'text').map((e) => e.text).join(''), 'Checking… Done.');
  assert.deepEqual(ra.filter((e) => e.type === 'tool').map((e) => e.name), ['fleet_status', 'find_vehicle']);
  assert.equal(ra.at(-1).type, 'done');
  assert.ok(seenByModel.includes('AI11AA0001'), 'owner org sees its vehicle');
  const last = seen[1].messages.at(-1);
  assert.equal(last.role, 'user'); assert.equal(last.content.length, 2, 'both tool results returned in a single user message');
  assert.equal(seen[0].tools.length, 6); assert.ok(seen[0].system.includes('read-only'));

  // other tenant: same questions must not reveal org A's vehicle
  seenByModel = '';
  const { client: c2 } = fakeClient([
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'find_vehicle', input: { query: 'AI11' } }] }),
    (p) => { seenByModel = JSON.stringify(p.messages.at(-1)); return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }; },
  ]);
  const app3 = await buildApp({ aiClient: () => c2 });
  await app3.inject({ method: 'POST', url: '/api/assistant/chat', headers: b, payload: { messages: [{ role: 'user', content: 'x' }] } });
  assert.ok(!seenByModel.includes('AI11AA0001'), 'other org must not see it');
  assert.ok(seenByModel.includes('total_matches\\":0') || seenByModel.includes('"total_matches":0'));
  await app2.close(); await app3.close();
});

test('assistant: invalid tool input becomes an error result the model can fix; API errors become error events', async () => {
  const h = await signup();
  let toolResult: any;
  const { client } = fakeClient([
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'bad', name: 'vehicle_trips', input: { days: 999 } }] }),
    (p) => { toolResult = p.messages.at(-1).content[0]; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }; },
  ]);
  const app2 = await buildApp({ aiClient: () => client });
  await app2.inject({ method: 'POST', url: '/api/assistant/chat', headers: h, payload: { messages: [{ role: 'user', content: 'x' }] } });
  assert.equal(toolResult.is_error, true);

  const boom: any = { beta: { messages: { stream() { return { on() { return this; }, abort() {}, async finalMessage() { throw new (await import('@anthropic-ai/sdk')).default.RateLimitError(429, {}, 'slow down', new Headers()); } }; } } } };
  const app3 = await buildApp({ aiClient: () => boom });
  const ev = sse((await app3.inject({ method: 'POST', url: '/api/assistant/chat', headers: h, payload: { messages: [{ role: 'user', content: 'x' }] } })).payload);
  assert.equal(ev.at(-1).code, 'rate_limited');
  await app2.close(); await app3.close();
});

test('vehicle image_url validation + trips list', async () => {
  const h = await signup();
  assert.equal((await j(h, 'POST', '/api/vehicles', { reg_number: 'IM11AA0001', image_url: 'javascript:alert(1)' })).statusCode, 400);
  const ok = await j(h, 'POST', '/api/vehicles', { reg_number: 'IM11AA0001', image_url: 'https://example.com/truck.jpg' });
  assert.equal(ok.statusCode, 201); assert.equal(ok.json().image_url, 'https://example.com/truck.jpg');
  const blank = await j(h, 'PUT', `/api/vehicles/${ok.json().id}`, { reg_number: 'IM11AA0001', image_url: '' });
  assert.equal(blank.json().image_url, null);

  const d = (await j(h, 'POST', '/api/devices', { imei: imeiOf(), vehicle_id: ok.json().id })).json();
  const t0 = Date.now() - 3600_000;
  const positions = [0, 40, 60, 60].map((s, i) => ({ ts: new Date(t0 + i * 60_000).toISOString(), lat: 19, lng: 72.8 + i * 0.01, speed_kmh: s, ignition: true }));
  await app.inject({ method: 'POST', url: '/api/ingest', headers: { 'x-device-key': d.api_key }, payload: { imei: d.imei, positions } });
  const t = (await j(h, 'GET', '/api/trips?days=7')).json();
  assert.equal(t.total, 1); assert.equal(t.rows[0].reg_number, 'IM11AA0001'); assert.ok(t.total_km > 2);
  assert.equal((await j(await signup(), 'GET', '/api/trips?days=7')).json().total, 0);
});
