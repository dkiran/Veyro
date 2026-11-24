import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDate, fmtNum } from '../i18n';

interface Trip { id: string; vehicle_id: string; reg_number: string; driver_name: string | null; start_ts: string; end_ts: string | null; distance_km: number; max_speed_kmh: number; avg_speed_kmh: number | null }
const PAGE = 25;
const dur = (a: string, b: string | null) => { const m = Math.max(0, Math.round(((b ? +new Date(b) : Date.now()) - +new Date(a)) / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

export default function Trips() {
  const { t } = useTranslation();
  const [days, setDays] = useState(7);
  const [vehicle, setVehicle] = useState('');
  const [page, setPage] = useState(0);
  const [vehicles, setVehicles] = useState<{ id: string; reg_number: string }[]>([]);
  const [data, setData] = useState<{ total: number; total_km: number; rows: Trip[] } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => { api('/api/vehicles').then(setVehicles).catch(() => {}); }, []);
  useEffect(() => {
    setErr(false);
    api(`/api/trips?days=${days}&limit=${PAGE}&offset=${page * PAGE}${vehicle ? `&vehicle_id=${vehicle}` : ''}`).then(setData).catch(() => setErr(true));
  }, [days, vehicle, page]);
  const reset = (fn: () => void) => { fn(); setPage(0); };

  const total = data?.total ?? 0;
  const from = total ? page * PAGE + 1 : 0, to = Math.min(total, (page + 1) * PAGE);
  return (
    <div className="page">
      <div className="page-head"><h2>{t('t.title')}</h2>
        <div className="filters">
          <select aria-label={t('t.period')} value={days} onChange={(e) => reset(() => setDays(+e.target.value))}>
            {[1, 7, 30, 90].map((d) => <option key={d} value={d}>{t(`d.p${d}`)}</option>)}
          </select>
          <select aria-label={t('f.vehicle')} value={vehicle} onChange={(e) => reset(() => setVehicle(e.target.value))}>
            <option value="">{t('t.allVehicles')}</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.reg_number}</option>)}
          </select>
        </div>
      </div>
      {data && <div className="muted small summary">{t('t.summary', { trips: fmtNum(data.total, 0), km: fmtNum(data.total_km, 0) })}</div>}
      <div className="tablewrap">
        <table>
          <thead><tr><th>{t('f.vehicle')}</th><th>{t('d.driver')}</th><th>{t('f.start')}</th><th>{t('f.end')}</th><th>{t('f.distance')}</th><th>{t('f.duration')}</th><th>{t('f.avg_speed')}</th><th>{t('f.max_speed')}</th><th /></tr></thead>
          <tbody>
            {err && <tr><td colSpan={9} className="muted pad">{t('d.error')}</td></tr>}
            {!err && !data && <tr><td colSpan={9} className="muted pad">{t('c.loading')}</td></tr>}
            {data && data.rows.length === 0 && <tr><td colSpan={9} className="muted pad">{t('t.empty')}</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.reg_number}</b></td>
                <td>{r.driver_name ?? <span className="muted">—</span>}</td>
                <td>{fmtDate(r.start_ts)}</td>
                <td>{r.end_ts ? fmtDate(r.end_ts) : <span className="pill ok">{t('f.ongoing')}</span>}</td>
                <td>{fmtNum(r.distance_km, 1)} km</td>
                <td>{dur(r.start_ts, r.end_ts)}</td>
                <td>{r.avg_speed_kmh == null ? '—' : `${fmtNum(r.avg_speed_kmh, 0)} km/h`}</td>
                <td>{fmtNum(r.max_speed_kmh, 0)} km/h</td>
                <td className="actions"><Link className="linkbtn" to={`/history?vehicle=${r.vehicle_id}&from=${encodeURIComponent(r.start_ts)}&to=${encodeURIComponent(new Date(+new Date(r.end_ts ?? Date.now()) + 60_000).toISOString())}`}>{t('t.view')}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > PAGE && (
        <div className="pager">
          <span className="muted small">{t('t.showing', { from, to, total })}</span>
          <div className="row"><button disabled={page === 0} onClick={() => setPage(page - 1)}>{t('t.prev')}</button><button disabled={to >= total} onClick={() => setPage(page + 1)}>{t('t.next')}</button></div>
        </div>
      )}
    </div>
  );
}
