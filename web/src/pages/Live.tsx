import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { api, getToken } from '../api';
import { fmtDate, fmtNum } from '../i18n';
import { STATUS_COLOR, makeMap, vehicleIcon } from './map';
import VehicleThumb from './VehicleThumb';

interface V { vehicle_id: string; reg_number: string; name: string | null; type: string; image_url: string | null; driver_name: string | null; ts: string; lat: number; lng: number; speed_kmh: number; heading: number | null; status: string; odometer_km: number }
const STATUSES = ['moving', 'idle', 'stopped', 'offline'] as const;
const readOpen = () => { try { return localStorage.getItem('veyro.liveDrawer') !== '0'; } catch { return true; } };

export default function Live() {
  const { t } = useTranslation();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const markers = useRef(new Map<string, L.Marker>());
  const [vehicles, setVehicles] = useState<Record<string, V>>({});
  const [connected, setConnected] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(readOpen);
  const fitted = useRef(false);

  useEffect(() => {
    map.current = makeMap(el.current!);
    return () => { map.current?.remove(); markers.current.clear(); };
  }, []);

  // The map must be told its container changed size once the drawer finishes sliding.
  const toggle = () => {
    const n = !open; setOpen(n);
    try { localStorage.setItem('veyro.liveDrawer', n ? '1' : '0'); } catch { /* ignore */ }
    setTimeout(() => map.current?.invalidateSize(), 280);
  };
  useEffect(() => { const i = setTimeout(() => map.current?.invalidateSize(), 50); return () => clearTimeout(i); }, []);

  useEffect(() => {
    let ws: WebSocket | undefined, stop = false, timer: any;
    const load = () => api<V[]>('/api/live/snapshot').then((rows) => setVehicles(Object.fromEntries(rows.map((r) => [r.vehicle_id, r]))));
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live/ws?token=${getToken()}`);
      ws.onopen = () => { setConnected(true); load(); };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.type === 'position') {
          setVehicles((cur) => cur[msg.data.vehicle_id] ? { ...cur, [msg.data.vehicle_id]: { ...cur[msg.data.vehicle_id], ...msg.data } } : cur);
          if (!markers.current.has(msg.data.vehicle_id)) load();
        }
      };
      ws.onclose = () => { setConnected(false); if (!stop) timer = setTimeout(connect, 3000); };
    };
    load(); connect();
    return () => { stop = true; clearTimeout(timer); ws?.close(); };
  }, []);

  // Statuses age (moving -> offline) without any new message, so re-evaluate periodically.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);
  const withStatus = useMemo(() => Object.values(vehicles).map((v) => now - new Date(v.ts).getTime() > 10 * 60_000 ? { ...v, status: 'offline' } : v), [vehicles, now]);

  useEffect(() => {
    const m = map.current!;
    for (const v of withStatus) {
      let mk = markers.current.get(v.vehicle_id);
      if (!mk) {
        mk = L.marker([v.lat, v.lng], { icon: vehicleIcon(v.status, v.heading) }).addTo(m).bindTooltip(`<b>${esc(v.reg_number)}</b>`, { direction: 'top', offset: [0, -12] });
        mk.on('click', () => setSelected(v.vehicle_id));
        markers.current.set(v.vehicle_id, mk);
      } else mk.setLatLng([v.lat, v.lng]).setIcon(vehicleIcon(v.status, v.heading));
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

  const counts = withStatus.reduce<Record<string, number>>((a, v) => ((a[v.status] = (a[v.status] ?? 0) + 1), a), {});
  const list = withStatus
    .filter((v) => (!filter || v.status === filter) && (v.reg_number + (v.name ?? '') + (v.driver_name ?? '')).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.reg_number.localeCompare(b.reg_number));

  return (
    <div className="split live">
      <aside className={`drawer ${open ? '' : 'closed'}`} aria-hidden={!open} {...(!open ? { inert: '' as any } : {})}>
        <div className="drawer-in">
          <div className="panel-head">
            <h2>{t('live.vehicles')} <span className="muted small">({withStatus.length})</span></h2>
            <div className="row">
              <span className={`pill ${connected ? 'ok' : 'warn'}`}>{connected ? t('live.connected') : t('live.disconnected')}</span>
              <button className="icon-btn" onClick={toggle} aria-label={t('live.collapse')} title={t('live.collapse')}>‹</button>
            </div>
          </div>
          <div className="chips">
            <button className={`chip ${filter === null ? 'on' : ''}`} onClick={() => setFilter(null)}>{t('live.all')} <b>{withStatus.length}</b></button>
            {STATUSES.map((s) => (
              <button key={s} className={`chip ${filter === s ? 'on' : ''}`} aria-pressed={filter === s} onClick={() => setFilter(filter === s ? null : s)}>
                <i style={{ background: STATUS_COLOR[s] }} />{t(`s.${s}`)} <b>{counts[s] ?? 0}</b>
              </button>
            ))}
          </div>
          <input className="search" placeholder={t('c.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="vlist">
            {withStatus.length === 0 && <li className="muted pad">{t('live.noVehicles')}</li>}
            {withStatus.length > 0 && list.length === 0 && <li className="muted pad">{t('live.noMatch')}</li>}
            {list.map((v) => (
              <li key={v.vehicle_id} className={selected === v.vehicle_id ? 'sel' : ''} onClick={() => setSelected(v.vehicle_id)}>
                <VehicleThumb url={v.image_url} type={v.type} />
                <div className="vinfo">
                  <div className="vtop"><span className="vreg">{v.reg_number}</span><span className="spill" style={{ ['--c' as any]: STATUS_COLOR[v.status] }}><i />{t(`s.${v.status}`)}</span></div>
                  {v.name && <div className="muted small">{v.name}</div>}
                  <div className="muted small">{fmtNum(v.speed_kmh, 0)} km/h{v.driver_name ? ` · ${v.driver_name}` : ''}</div>
                  <div className="muted small">{t('live.updated')}: {fmtDate(v.ts)}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <div className="mapwrap">
        <div className="map" ref={el} />
        {!open && (
          <button className="drawer-tab" onClick={toggle} aria-label={t('live.expand')} title={t('live.expand')}>
            <span aria-hidden="true">›</span><b>{withStatus.length}</b><span className="vlabel">{t('live.vehicles')}</span>
          </button>
        )}
      </div>
    </div>
  );
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
