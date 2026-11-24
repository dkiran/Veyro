/**
 * Demo data + GPS simulator. Creates a demo org (or logs in), adds vehicles/drivers/devices,
 * backfills some history, then streams live positions.
 *   npm run simulate            # live stream
 *   npm run simulate -- --backfill-hours 6 --vehicles 8
 */
const API = process.env.API ?? 'http://localhost:4000';
const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const N = arg('vehicles', 6), BACKFILL_H = arg('backfill-hours', 3);

const EMAIL = 'demo@veyro.app', PASSWORD = 'demo12345';
const cities: [string, number, number][] = [
  ['Mumbai', 19.076, 72.8777], ['Pune', 18.5204, 73.8567], ['Nashik', 19.9975, 73.7898], ['Surat', 21.1702, 72.8311],
  ['Ahmedabad', 23.0225, 72.5714], ['Bengaluru', 12.9716, 77.5946], ['Hyderabad', 17.385, 78.4867], ['Chennai', 13.0827, 80.2707],
  ['Delhi', 28.6139, 77.209], ['Jaipur', 26.9124, 75.7873],
];
const drivers = ['Ramesh Kumar', 'Suresh Patil', 'Mohammed Irfan', 'Gurpreet Singh', 'Anil Yadav', 'Karthik Raj', 'Vijay Sharma', 'Imran Khan'];
const regs = ['MH12AB1001', 'MH14CD2002', 'GJ05EF3003', 'KA01GH4004', 'TS09JK5005', 'TN10LM6006', 'DL01NP7007', 'RJ14QR8008'];

async function call(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function auth() {
  try { return (await call('/api/auth/signup', 'POST', { orgName: 'Demo Logistics', name: 'Demo Admin', email: EMAIL, password: PASSWORD })).token; }
  catch (e: any) {
    if (!String(e.message).includes(' 409 ')) console.error('signup failed:', e.message); // 409 = demo user already exists
    return (await call('/api/auth/login', 'POST', { email: EMAIL, password: PASSWORD })).token;
  }
}

interface Sim { idleUntil: number; imei: string; key: string; lat: number; lng: number; heading: number; speed: number; dest: [number, number]; t: number; stopUntil: number }

function step(s: Sim, dtSec: number) {
  if (s.t < s.stopUntil) { s.speed = 0; s.t += dtSec * 1000; return; }
  const dLat = s.dest[0] - s.lat, dLng = s.dest[1] - s.lng;
  const distKm = Math.hypot(dLat * 111, dLng * 111 * Math.cos(s.lat * Math.PI / 180));
  if (distKm < 1) { // arrived: rest 10-20 min, then pick a new destination
    s.stopUntil = s.t + (600 + Math.random() * 600) * 1000;
    s.idleUntil = s.t + (60 + Math.random() * 180) * 1000; // engine left running for 1-4 min, then off
    const c = cities[Math.floor(Math.random() * cities.length)]; s.dest = [c[1], c[2]];
    s.speed = 0; s.t += dtSec * 1000; return;
  }
  s.heading = (Math.atan2(dLng * Math.cos(s.lat * Math.PI / 180), dLat) * 180 / Math.PI + 360) % 360;
  s.speed = Math.max(25, Math.min(72, s.speed + (Math.random() - 0.5) * 8 || 55)); // cruise below the overspeed limit
  const k = (s.speed * dtSec / 3600) / distKm;
  s.lat += dLat * k; s.lng += dLng * k; s.t += dtSec * 1000;
}
const fix = (s: Sim) => ({ ts: new Date(s.t).toISOString(), lat: +s.lat.toFixed(6), lng: +s.lng.toFixed(6), speed_kmh: +s.speed.toFixed(1), heading: +s.heading.toFixed(0), ignition: s.speed > 0 || s.t < s.idleUntil });

async function main() {
  const token = await auth(); const h = { authorization: `Bearer ${token}` };
  const existing = await call('/api/vehicles', 'GET', undefined, h);
  const sims: Sim[] = [];
  for (let i = 0; i < N; i++) {
    const reg = regs[i % regs.length] + (i >= regs.length ? String(i) : '');
    let v = existing.find((x: any) => x.reg_number === reg);
    let dev;
    if (!v) {
      const drv = await call('/api/drivers', 'POST', { name: drivers[i % drivers.length], phone: `+91980000${1000 + i}`, license_number: `DL-${1000 + i}`, preferred_language: ['hi', 'mr', 'en', 'pa', 'hi', 'ta', 'hi', 'en'][i % 8] }, h);
      v = await call('/api/vehicles', 'POST', { reg_number: reg, name: `Truck ${i + 1}`, type: i % 3 === 0 ? 'van' : 'truck', driver_id: drv.id }, h);
      dev = await call('/api/devices', 'POST', { imei: String(860000000000000 + i), model: 'FMB920', vehicle_id: v.id }, h);
    } else {
      dev = (await call('/api/devices', 'GET', undefined, h)).find((d: any) => d.vehicle_id === v.id);
    }
    const c = cities[i % cities.length], d = cities[(i * 3 + 1) % cities.length];
    sims.push({ imei: dev.imei, key: dev.api_key, lat: c[1], lng: c[2], heading: 0, speed: 50, dest: [d[1], d[2]], t: Date.now() - BACKFILL_H * 3600_000, stopUntil: 0, idleUntil: 0 });
  }
  console.log(`Backfilling ${BACKFILL_H}h for ${sims.length} vehicles...`);
  for (const s of sims) {
    const batch: any[] = [];
    while (s.t < Date.now() - 5000) {
      step(s, 10); batch.push(fix(s));
      if (s.speed > 45 && Math.random() < 0.0015) { // harsh braking: -40 km/h in 3 s
        const f = fix(s); batch.push({ ...f, ts: new Date(s.t + 3000).toISOString(), speed_kmh: f.speed_kmh - 40 });
      } else if (s.speed > 30 && Math.random() < 0.001) { // hard acceleration into overspeed
        const f = fix(s); batch.push({ ...f, ts: new Date(s.t + 3000).toISOString(), speed_kmh: Math.min(98, f.speed_kmh + 40) });
      }
      if (batch.length === 500) { await call('/api/ingest', 'POST', { imei: s.imei, positions: batch.splice(0) }, { 'x-device-key': s.key }); }
    }
    if (batch.length) await call('/api/ingest', 'POST', { imei: s.imei, positions: batch }, { 'x-device-key': s.key });
  }
  console.log('Streaming live positions every 3s. Login:', EMAIL, '/', PASSWORD);
  setInterval(async () => {
    for (const s of sims) {
      s.t = Date.now(); step(s, 3); s.t = Date.now();
      if (s.speed > 45 && Math.random() < 0.002) s.speed -= 40;      // harsh braking
      else if (s.speed > 0 && Math.random() < 0.001) s.speed = Math.min(98, s.speed + 40); // hard acceleration / overspeed
      await call('/api/ingest', 'POST', { imei: s.imei, positions: [fix(s)] }, { 'x-device-key': s.key }).catch((e) => console.error(e.message));
    }
  }, 3000);
}
main();
