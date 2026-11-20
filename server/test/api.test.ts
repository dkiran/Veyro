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
