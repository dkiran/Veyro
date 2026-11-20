import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { api, getToken } from '../api';
import { fmtDate, fmtNum } from '../i18n';
import { STATUS_COLOR, makeMap, vehicleIcon } from './map';

interface V { vehicle_id: string; reg_number: string; name: string | null; driver_name: string | null; ts: string; lat: number; lng: number; speed_kmh: number; heading: number | null; status: string; odometer_km: number }

export default function Live() {
  const { t } = useTranslation();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const markers = useRef(new Map<string, L.Marker>());
  const [vehicles, setVehicles] = useState<Record<string, V>>({});
  const [connected, setConnected] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    map.current = makeMap(el.current!);
    return () => { map.current?.remove(); markers.current.clear(); };
  }, []);

  // Initial snapshot, then WebSocket updates (auto-reconnect; snapshot is re-fetched after a reconnect).
  useEffect(() => {
    let ws: WebSocket | undefined, stop = false, timer: any;
    const load = () => api<V[]>('/api/live/snapshot').then((rows) => setVehicles(Object.fromEntries(rows.map((r) => [r.vehicle_id, r]))));
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live/ws?token=${getToken()}`);
      ws.onopen = () => { setConnected(true); load(); };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.type === 'position') setVehicles((cur) => cur[msg.data.vehicle_id] ? { ...cur, [msg.data.vehicle_id]: { ...cur[msg.data.vehicle_id], ...msg.data } } : cur);
        if (msg.type === 'position' && !markers.current.has(msg.data.vehicle_id)) load(); // a vehicle we haven't seen yet
      };
      ws.onclose = () => { setConnected(false); if (!stop) timer = setTimeout(connect, 3000); };
    };
    load(); connect();
    return () => { stop = true; clearTimeout(timer); ws?.close(); };
  }, []);

  // Statuses age (moving -> offline) without any new message, so re-evaluate periodically.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);
  const withStatus = useMemo(() => Object.values(vehicles).map((v) =>
    now - new Date(v.ts).getTime() > 10 * 60_000 ? { ...v, status: 'offline' } : v), [vehicles, now]);

  useEffect(() => {
    const m = map.current!;
    for (const v of withStatus) {
      let mk = markers.current.get(v.vehicle_id);
      const label = `<b>${esc(v.reg_number)}</b>`;
      if (!mk) {
        mk = L.marker([v.lat, v.lng], { icon: vehicleIcon(v.status, v.heading) }).addTo(m).bindTooltip(label, { direction: 'top', offset: [0, -12] });
        mk.on('click', () => setSelected(v.vehicle_id));
        markers.current.set(v.vehicle_id, mk);
      } else {
        mk.setLatLng([v.lat, v.lng]).setIcon(vehicleIcon(v.status, v.heading));
      }
    }
    if (!fitted.current && withStatus.length) {
      m.fitBounds(L.latLngBounds(withStatus.map((v) => [v.lat, v.lng] as [number, number])).pad(0.2), { maxZoom: 12 });
      fitted.current = true;
    }
  }, [withStatus]);

  useEffect(() => {
    const v = selected && vehicles[selected];
    if (v) map.current?.flyTo([v.lat, v.lng], Math.max(map.current.getZoom(), 13), { duration: 0.6 });
  }, [selected]); // eslint-disable-line

  const list = withStatus.filter((v) => (v.reg_number + (v.name ?? '') + (v.driver_name ?? '')).toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.reg_number.localeCompare(b.reg_number));
  const counts = withStatus.reduce<Record<string, number>>((a, v) => ((a[v.status] = (a[v.status] ?? 0) + 1), a), {});

  return (
    <div className="split">
      <section className="panel">
        <div className="panel-head">
          <h2>{t('live.title')}</h2>
          <span className={`pill ${connected ? 'ok' : 'warn'}`}>{connected ? t('live.connected') : t('live.disconnected')}</span>
        </div>
        <div className="chips">
          {['moving', 'idle', 'stopped', 'offline'].map((s) => (
            <span key={s} className="chip"><i style={{ background: STATUS_COLOR[s] }} />{t(`s.${s}`)} <b>{counts[s] ?? 0}</b></span>
          ))}
        </div>
        <input className="search" placeholder={t('c.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="vlist">
          {list.length === 0 && <li className="muted pad">{t('live.noVehicles')}</li>}
          {list.map((v) => (
            <li key={v.vehicle_id} className={selected === v.vehicle_id ? 'sel' : ''} onClick={() => setSelected(v.vehicle_id)}>
              <i className="sdot" style={{ background: STATUS_COLOR[v.status] }} />
              <div>
                <div className="vreg">{v.reg_number} <span className="muted">{v.name}</span></div>
                <div className="muted small">{t(`s.${v.status}`)} · {fmtNum(v.speed_kmh, 0)} km/h{v.driver_name ? ` · ${v.driver_name}` : ''}</div>
                <div className="muted small">{t('live.updated')}: {fmtDate(v.ts)}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="map" ref={el} />
    </div>
  );
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
