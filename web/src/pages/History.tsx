import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { api } from '../api';
import { fmtDate, fmtNum } from '../i18n';
import { makeMap } from './map';

interface Pt { ts: string; lat: number; lng: number; speed_kmh: number; heading: number | null }
interface Trip { id: string; start_ts: string; end_ts: string | null; distance_km: number; max_speed_kmh: number; driver_name: string | null }

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const dur = (a: string, b: string | null) => { const m = Math.round(((b ? +new Date(b) : Date.now()) - +new Date(a)) / 60000); return `${Math.floor(m / 60)}h ${m % 60}m`; };

export default function History() {
  const { t } = useTranslation();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const layer = useRef<L.LayerGroup>();
  const cursor = useRef<L.CircleMarker>();
  const [vehicles, setVehicles] = useState<{ id: string; reg_number: string }[]>([]);
  const [vid, setVid] = useState('');
  const [from, setFrom] = useState(toLocalInput(new Date(Date.now() - 6 * 3600_000)));
  const [to, setTo] = useState(toLocalInput(new Date()));
  const [pts, setPts] = useState<Pt[]>([]);
  const [total, setTotal] = useState(0);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    map.current = makeMap(el.current!); layer.current = L.layerGroup().addTo(map.current);
    api('/api/vehicles').then((v) => {
      setVehicles(v);
      const sp = new URLSearchParams(location.search), want = sp.get('vehicle');
      const id = want && v.some((x: { id: string }) => x.id === want) ? want : v[0]?.id;
      if (id) setVid(id);
      if (want && id === want && sp.get('from') && sp.get('to') && !isNaN(+new Date(sp.get('from')!)) && !isNaN(+new Date(sp.get('to')!))) {
        const f = toLocalInput(new Date(sp.get('from')!)), tt = toLocalInput(new Date(sp.get('to')!));
        setFrom(f); setTo(tt); show(f, tt, id); // opened from the Trips page: show that route straight away
      }
    });
    return () => { map.current?.remove(); };
  }, []);

  async function show(f = from, tt = to, v = vid) {
    if (!v) return;
    setBusy(true); setPlaying(false);
    const qs = `from=${encodeURIComponent(new Date(f).toISOString())}&to=${encodeURIComponent(new Date(tt).toISOString())}`;
    try {
      const [h, tr] = await Promise.all([api(`/api/vehicles/${v}/history?${qs}`), api(`/api/vehicles/${v}/trips?${qs}`)]);
      setPts(h.points); setTotal(h.total); setTrips(tr); setIdx(0); setLoaded(true);
    } finally { setBusy(false); }
  }

  useEffect(() => {
    const m = map.current!, g = layer.current!; g.clearLayers(); cursor.current = undefined;
    if (!pts.length) return;
    const ll = pts.map((p) => [p.lat, p.lng] as [number, number]);
    L.polyline(ll, { color: '#2563eb', weight: 4, opacity: 0.85 }).addTo(g);
    L.circleMarker(ll[0], { radius: 8, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }).addTo(g);
    L.circleMarker(ll[ll.length - 1], { radius: 8, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }).addTo(g);
    cursor.current = L.circleMarker(ll[0], { radius: 7, color: '#111', weight: 2, fillColor: '#facc15', fillOpacity: 1 }).addTo(g);
    m.fitBounds(L.latLngBounds(ll).pad(0.15));
  }, [pts]);

  useEffect(() => { const p = pts[idx]; if (p) cursor.current?.setLatLng([p.lat, p.lng]); }, [idx, pts]);
  useEffect(() => {
    if (!playing) return;
    const i = setInterval(() => setIdx((n) => { if (n >= pts.length - 1) { setPlaying(false); return n; } return n + 1; }), 80);
    return () => clearInterval(i);
  }, [playing, pts.length]);

  const cur = pts[idx];
  return (
    <div className="split">
      <section className="panel">
        <h2>{t('h.title')}</h2>
        <label>{t('h.vehicle')}
          <select value={vid} onChange={(e) => setVid(e.target.value)}>
            {vehicles.length === 0 && <option value="">{t('h.selectVehicle')}</option>}
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.reg_number}</option>)}
          </select>
        </label>
        <label>{t('h.from')}<input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{t('h.to')}<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="primary" disabled={!vid || busy} onClick={() => show()}>{busy ? t('c.loading') : t('h.show')}</button>

        {loaded && pts.length === 0 && <p className="muted pad">{t('h.noData')}</p>}
        {pts.length > 0 && (
          <div className="playback">
            <div className="row">
              <button onClick={() => { if (idx >= pts.length - 1) setIdx(0); setPlaying(!playing); }} aria-label={t('h.playback')}>{playing ? '❚❚' : '▶'}</button>
              <input type="range" min={0} max={pts.length - 1} value={idx} onChange={(e) => { setPlaying(false); setIdx(+e.target.value); }} />
            </div>
            {cur && <div className="small muted">{fmtDate(cur.ts)} · {fmtNum(cur.speed_kmh, 0)} km/h</div>}
            <div className="small muted">{t('h.points')}: {fmtNum(total, 0)}</div>
          </div>
        )}
        {trips.length > 0 && <>
          <h3>{t('h.trips')} ({trips.length})</h3>
          <ul className="trips">
            {trips.map((tr) => (
              <li key={tr.id} onClick={() => { const f = toLocalInput(new Date(tr.start_ts)), e = toLocalInput(new Date(tr.end_ts ?? Date.now())); setFrom(f); setTo(e); show(f, e); }}>
                <div>{fmtDate(tr.start_ts)}</div>
                <div className="muted small">{fmtNum(tr.distance_km)} km · {t('h.duration')} {dur(tr.start_ts, tr.end_ts)} · {t('h.maxSpeed')} {fmtNum(tr.max_speed_kmh, 0)} km/h{tr.driver_name ? ` · ${tr.driver_name}` : ''}</div>
              </li>
            ))}
          </ul>
        </>}
      </section>
      <div className="map" ref={el} />
    </div>
  );
}
