import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { fmtDate, fmtNum } from '../i18n';
import { Card, Delta, DonutLegend, Kpi, Ranked, Section, Segmented, StatusTile, Tip, compact, fmtDay, fmtInr, type Slice } from './dash-widgets';

type Day<T> = { day: string } & T;
interface D {
  meta: { days: number; generated_at: string; overspeed_kmh: number; harsh_kmh_per_s: number };
  status: { total: number; running: number; idle: number; stopped: number; no_gps: number; maintenance: number };
  utilization: { pct: number; used_vehicles: number; active_vehicles: number; avg_driving_h_per_vehicle_day: number; avg_km_per_vehicle_day: number; idle_share_pct: number;
    time_split_h: { moving: number; idle: number; stopped: number }; daily: Day<{ pct: number; vehicles: number }>[]; top_distance: { id: string; reg: string; km: number }[]; unused: { id: string; reg: string; name: string | null }[] };
  trips: { total: number; km: number; delta_trips_pct: number | null; delta_km_pct: number | null; avg_km: number; avg_duration_min: number; avg_speed_kmh: number;
    longest: { km: number; reg: string } | null; daily: Day<{ trips: number; km: number }>[]; by_hour: number[]; by_distance: { label: string; trips: number }[];
    recent: { id: string; reg_number: string; driver_name: string | null; start_ts: string; end_ts: string | null; km: number; max_speed: number }[] };
  behaviour: { score: number | null; overspeed: number; harsh_braking: number; harsh_acceleration: number; events_per_100km: number | null;
    daily: Day<{ overspeed: number; braking: number; acceleration: number }>[]; bands: { good: number; fair: number; risky: number };
    drivers: { id: string; name: string; km: number; events: number; per100km: number | null; score: number | null }[] };
  fuel: { cost: number; litres: number; cost_per_km: number | null; avg_km_per_litre: number | null; idle_cost: number; idle_litres: number; idle_share_pct: number;
    daily: Day<{ cost: number; idle_cost: number }>[]; by_vehicle: { id: string; reg: string; cost: number }[]; by_fuel_type: { fuel: string; cost: number }[] };
}

const PERIODS = [1, 7, 30, 90] as const;
const AX = { fill: 'var(--muted)', fontSize: 11 };
const hrs = (n: number) => `${fmtNum(n, 1)} h`;
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);

export default function Dashboard() {
  const { t } = useTranslation();
  const [days, setDays] = useState<number>(() => Number(localStorage.getItem('veyro.dashDays')) || 7);
  const [d, setD] = useState<D | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(() => api<D>(`/api/dashboard?days=${days}`).then((r) => { setD(r); setErr(false); }).catch(() => setErr(true)), [days]);
  useEffect(() => { setD(null); load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [load]);
  useEffect(() => { localStorage.setItem('veyro.dashDays', String(days)); }, [days]);

  const head = (
    <div className="dhead">
      <div><h1>{t('d.title')}</h1>{d && <div className="muted small">{t('d.updated')}: {fmtDate(d.meta.generated_at)}</div>}</div>
      <div className="seg-ctl" role="tablist">{PERIODS.map((p) => <button key={p} role="tab" aria-selected={days === p} className={days === p ? 'on' : ''} onClick={() => setDays(p)}>{t(`d.p${p}`)}</button>)}</div>
    </div>
  );
  if (err && !d) return <div className="dash">{head}<div className="dcard pad">{t('d.error')} <button onClick={load}>{t('d.retry')}</button></div></div>;
  if (!d) return <div className="dash">{head}<div className="skeleton" /></div>;

  const { status: st, utilization: u, trips: tr, behaviour: b, fuel: f } = d;
  const pctOf = (n: number) => `${fmtNum(st.total ? (n / st.total) * 100 : 0, 0)}% ${t('d.ofFleet')}`;
  const statusSlices: Slice[] = [
    { key: 'running', label: t('d.running'), value: st.running, color: 'var(--good)' },
    { key: 'idle', label: t('d.idle'), value: st.idle, color: 'var(--warn)' },
    { key: 'stopped', label: t('d.stopped'), value: st.stopped, color: 'var(--crit)' },
    { key: 'nogps', label: t('d.nogps'), value: st.no_gps, color: 'var(--nogps)' },
  ];
  const evSlices: Slice[] = [
    { key: 'over', label: t('d.overspeed'), value: b.overspeed, color: 'var(--s1)' },
    { key: 'brake', label: t('d.braking'), value: b.harsh_braking, color: 'var(--s2)' },
    { key: 'acc', label: t('d.accel'), value: b.harsh_acceleration, color: 'var(--s3)' },
  ];
  const evTotal = b.overspeed + b.harsh_braking + b.harsh_acceleration;
  const fuelTypeColors = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
  const fuelTypeSlices: Slice[] = f.by_fuel_type.slice(0, 3).map((x, i) => ({ key: x.fuel, label: t(`e.${x.fuel}`, { defaultValue: x.fuel }) as string, value: x.cost, color: fuelTypeColors[i] }));
  const tick = { ...AX, tickMargin: 6 };
  const xDay = <XAxis dataKey="day" tickFormatter={fmtDay} tick={tick} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} minTickGap={24} />;
  const grid = <CartesianGrid vertical={false} stroke="var(--grid)" />;
  const bandColor = (s: number) => (s >= 85 ? 'var(--good)' : s >= 70 ? 'var(--warn)' : 'var(--crit)');
  const bandLabel = (s: number) => (s >= 85 ? t('d.good') : s >= 70 ? t('d.fair') : t('d.risky'));
  const empty = <div className="muted pad">{t('d.noData')}</div>;

  return (
    <div className="dash">
      {head}

      {/* ---------- Fleet status ---------- */}
      <Section title={t('d.fleetStatus')}>
        <div className="grid tiles">
          <StatusTile kind="total" label={t('d.total')} value={st.total} color="var(--s1)" foot={st.maintenance ? t('d.maintenance', { n: st.maintenance }) : ' '} />
          <StatusTile kind="running" label={t('d.running')} value={st.running} share={pctOf(st.running)} color="var(--good)" />
          <StatusTile kind="idle" label={t('d.idle')} value={st.idle} share={pctOf(st.idle)} color="var(--warn)" />
          <StatusTile kind="stopped" label={t('d.stopped')} value={st.stopped} share={pctOf(st.stopped)} color="var(--crit)" />
          <StatusTile kind="nogps" label={t('d.nogps')} value={st.no_gps} share={pctOf(st.no_gps)} color="var(--nogps)" />
        </div>
      </Section>

      {/* ---------- Utilization ---------- */}
      <Section title={t('d.util')}>
        <div className="grid cards">
          <Card title={t('d.fleetStatus')} span={1}>
            <div className="donut-row">
              <div className="donut"><ResponsiveContainer width="100%" height="100%"><PieChart>
                <Pie data={statusSlices} dataKey="value" nameKey="label" innerRadius="64%" outerRadius="100%" paddingAngle={st.total ? 2 : 0} stroke="none" isAnimationActive={false} minAngle={st.total ? 3 : 0}>
                  {statusSlices.map((s) => <Cell key={s.key} fill={s.color} />)}
                </Pie>
                <Tooltip content={<Tip rows={(p: any) => p.map((x: any) => ({ name: x.name, text: fmtNum(x.value, 0), color: x.payload.color }))} />} />
              </PieChart></ResponsiveContainer><div className="donut-c"><b>{fmtNum(st.total, 0)}</b><span>{t('d.total')}</span></div></div>
              <DonutLegend slices={statusSlices} centre={fmtNum(st.total, 0)} centreLabel={t('d.total')} />
            </div>
          </Card>
          <Card title={t('d.utilPct')} sub={t('d.utilHint', { used: u.used_vehicles, active: u.active_vehicles })}>
            <div className="hero">{fmtNum(u.pct, 0)}<span>%</span></div>
            <div className="meter"><span style={{ width: `${Math.min(100, u.pct)}%` }} /></div>
            <div className="mini3">
              <div><div className="kpi-label">{t('d.avgDrive')}</div><b>{hrs(u.avg_driving_h_per_vehicle_day)}</b></div>
              <div><div className="kpi-label">{t('d.avgKmVeh')}</div><b>{fmtNum(u.avg_km_per_vehicle_day, 0)} km</b></div>
              <div><div className="kpi-label">{t('d.idleShare')}</div><b>{fmtNum(u.idle_share_pct, 0)}%</b></div>
            </div>
          </Card>
          <Card title={t('d.timeSplit')}>
            <Segmented ariaLabel={t('d.timeSplit')} fmt={hrs} parts={[
              { key: 'moving', label: t('d.moving'), value: u.time_split_h.moving, color: 'var(--s1)' },
              { key: 'idle', label: t('d.idleT'), value: u.time_split_h.idle, color: 'var(--s2)' },
              { key: 'stopped', label: t('d.stoppedT'), value: u.time_split_h.stopped, color: 'var(--s3)' },
            ]} />
          </Card>
          <Card title={t('d.dailyUtil')} span={2}>
            <div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={u.daily} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              {grid}{xDay}<YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={AX} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ stroke: 'var(--axis)' }} content={<Tip fmtLabel={fmtDay} rows={(p: any) => [{ name: t('d.utilPct'), text: `${fmtNum(p[0].value, 0)}% · ${p[0].payload.vehicles} ${t('d.vehiclesShort')}`, color: 'var(--s1)' }]} />} />
              <Area type="linear" dataKey="pct" stroke="var(--s1)" strokeWidth={2} fill="var(--s1)" fillOpacity={0.1} isAnimationActive={false} activeDot={{ r: 5, fill: 'var(--s1)', stroke: 'var(--card)', strokeWidth: 2 }} dot={u.daily.length <= 14 ? { r: 4, fill: 'var(--s1)', stroke: 'var(--card)', strokeWidth: 2 } : false} />
            </AreaChart></ResponsiveContainer></div>
          </Card>
          <Card title={t('d.topDist')}>
            <Ranked rows={u.top_distance.map((x) => ({ key: x.id, label: x.reg, value: x.km }))} fmt={(n) => `${fmtNum(n, 0)} km`} empty={t('d.noData')} />
          </Card>
          <Card title={t('d.unused')} sub={u.unused.length ? undefined : t('d.allUsed')}>
            {u.unused.length > 0 && <ul className="plain">{u.unused.map((x) => <li key={x.id}><b>{x.reg}</b> <span className="muted">{x.name}</span></li>)}</ul>}
          </Card>
        </div>
      </Section>

      {/* ---------- Trips ---------- */}
      <Section title={t('d.trips')}>
        <div className="grid kpis">
          <Kpi label={t('d.totalTrips')} value={fmtNum(tr.total, 0)} delta={<Delta pct={tr.delta_trips_pct} label={t('d.vsPrev')} />} />
          <Kpi label={t('d.distance')} value={compact(tr.km)} unit="km" delta={<Delta pct={tr.delta_km_pct} label={t('d.vsPrev')} />} />
          <Kpi label={t('d.avgTrip')} value={fmtNum(tr.avg_km, 1)} unit="km" />
          <Kpi label={t('d.avgDur')} value={dur(tr.avg_duration_min)} />
          <Kpi label={t('d.avgSpeed')} value={fmtNum(tr.avg_speed_kmh, 0)} unit="km/h" />
          <Kpi label={t('d.longest')} value={tr.longest ? fmtNum(tr.longest.km, 0) : '—'} unit={tr.longest ? 'km' : undefined} sub={tr.longest?.reg} />
        </div>
        <div className="grid cards">
          <Card title={t('d.tripsPerDay')} span={2}>
            <div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={tr.daily} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              {grid}{xDay}<YAxis allowDecimals={false} tick={AX} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<Tip fmtLabel={fmtDay} rows={(p: any) => [{ name: t('d.trips'), text: fmtNum(p[0].value, 0), color: 'var(--s1)' }]} />} />
              <Bar dataKey="trips" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart></ResponsiveContainer></div>
          </Card>
          <Card title={t('d.byDist')}>
            <Ranked rows={tr.by_distance.map((x) => ({ key: x.label, label: x.label, value: x.trips }))} fmt={(n) => fmtNum(n, 0)} empty={t('d.noData')} />
          </Card>
          <Card title={t('d.kmPerDay')} span={2}>
            <div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={tr.daily} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              {grid}{xDay}<YAxis tickFormatter={compact} tick={AX} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ stroke: 'var(--axis)' }} content={<Tip fmtLabel={fmtDay} rows={(p: any) => [{ name: t('d.distance'), text: `${fmtNum(p[0].value, 0)} km`, color: 'var(--s1)' }]} />} />
              <Area type="linear" dataKey="km" stroke="var(--s1)" strokeWidth={2} fill="var(--s1)" fillOpacity={0.1} isAnimationActive={false} activeDot={{ r: 5, fill: 'var(--s1)', stroke: 'var(--card)', strokeWidth: 2 }} dot={false} />
            </AreaChart></ResponsiveContainer></div>
          </Card>
          <Card title={t('d.byHour')}>
            <div className="chart sm"><ResponsiveContainer width="100%" height="100%"><BarChart data={tr.by_hour.map((n, h) => ({ h, n }))} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
              {grid}<XAxis dataKey="h" tick={tick} interval={2} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} /><YAxis allowDecimals={false} tick={AX} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<Tip fmtLabel={(h: number) => `${String(h).padStart(2, '0')}:00`} rows={(p: any) => [{ name: t('d.trips'), text: fmtNum(p[0].value, 0), color: 'var(--s1)' }]} />} />
              <Bar dataKey="n" fill="var(--s1)" radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            </BarChart></ResponsiveContainer></div>
          </Card>
          <Card title={t('d.recent')} span={3}>
            {tr.recent.length === 0 ? empty : (
              <div className="tablewrap flat"><table className="dtable"><thead><tr><th>{t('d.vehicle')}</th><th>{t('d.driver')}</th><th>{t('d.when')}</th><th>{t('d.distance')}</th><th>{t('d.avgDur')}</th><th>{t('d.maxSpeed')}</th></tr></thead>
                <tbody>{tr.recent.map((r) => (
                  <tr key={r.id}><td><b>{r.reg_number}</b></td><td>{r.driver_name ?? <span className="muted">—</span>}</td><td>{fmtDate(r.start_ts)}</td><td>{fmtNum(r.km, 1)} km</td>
                    <td>{dur(Math.round(((r.end_ts ? +new Date(r.end_ts) : Date.now()) - +new Date(r.start_ts)) / 60000))}</td><td>{fmtNum(r.max_speed, 0)} km/h</td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
        </div>
      </Section>

      {/* ---------- Driver behaviour ---------- */}
      <Section title={t('d.behaviour')} note={t('d.behaviourNote', { limit: d.meta.overspeed_kmh, g: d.meta.harsh_kmh_per_s })}>
        <div className="grid kpis">
          <Kpi label={t('d.safety')} value={b.score === null ? '—' : fmtNum(b.score, 0)} unit={b.score === null ? undefined : '/100'} />
          <Kpi label={t('d.overspeed')} value={fmtNum(b.overspeed, 0)} />
          <Kpi label={t('d.braking')} value={fmtNum(b.harsh_braking, 0)} />
          <Kpi label={t('d.accel')} value={fmtNum(b.harsh_acceleration, 0)} />
          <Kpi label={t('d.per100')} value={b.events_per_100km === null ? '—' : fmtNum(b.events_per_100km, 1)} />
        </div>
        <div className="grid cards">
          <Card title={t('d.eventMix')}>
            {evTotal === 0 ? empty : (
              <div className="donut-row">
                <div className="donut"><ResponsiveContainer width="100%" height="100%"><PieChart>
                  <Pie data={evSlices} dataKey="value" nameKey="label" innerRadius="64%" outerRadius="100%" paddingAngle={2} stroke="none" isAnimationActive={false} minAngle={3}>{evSlices.map((s) => <Cell key={s.key} fill={s.color} />)}</Pie>
                  <Tooltip content={<Tip rows={(p: any) => p.map((x: any) => ({ name: x.name, text: fmtNum(x.value, 0), color: x.payload.color }))} />} />
                </PieChart></ResponsiveContainer><div className="donut-c"><b>{fmtNum(evTotal, 0)}</b><span>{t('d.events')}</span></div></div>
                <DonutLegend slices={evSlices} centre={fmtNum(evTotal, 0)} centreLabel={t('d.events')} />
              </div>
            )}
          </Card>
          <Card title={t('d.eventsPerDay')} span={2}>
            <div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={b.daily} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              {grid}{xDay}<YAxis allowDecimals={false} tick={AX} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<Tip fmtLabel={fmtDay} rows={(p: any) => p.map((x: any) => ({ name: x.name, text: fmtNum(x.value, 0), color: x.fill }))} />} />
              <Bar dataKey="overspeed" name={t('d.overspeed')} stackId="e" fill="var(--s1)" stroke="var(--card)" strokeWidth={2} maxBarSize={24} isAnimationActive={false} />
              <Bar dataKey="braking" name={t('d.braking')} stackId="e" fill="var(--s2)" stroke="var(--card)" strokeWidth={2} maxBarSize={24} isAnimationActive={false} />
              <Bar dataKey="acceleration" name={t('d.accel')} stackId="e" fill="var(--s3)" stroke="var(--card)" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart></ResponsiveContainer></div>
          </Card>
          <Card title={t('d.riskBands')}>
            {b.bands.good + b.bands.fair + b.bands.risky === 0 ? <div className="muted pad">{t('d.noDrivers')}</div> : (
              <Segmented ariaLabel={t('d.riskBands')} fmt={(n) => fmtNum(n, 0)} parts={[
                { key: 'good', label: t('d.good'), value: b.bands.good, color: 'var(--good)' },
                { key: 'warn', label: t('d.fair'), value: b.bands.fair, color: 'var(--warn)' },
                { key: 'risky', label: t('d.risky'), value: b.bands.risky, color: 'var(--crit)' },
              ]} />
            )}
          </Card>
          <Card title={t('d.leaderboard')} span={2}>
            {b.drivers.filter((x) => x.score !== null).length === 0 ? <div className="muted pad">{t('d.noDrivers')}</div> : (
              <div className="tablewrap flat"><table className="dtable"><thead><tr><th>{t('d.driver')}</th><th>{t('d.score')}</th><th>{t('d.distance')}</th><th>{t('d.events')}</th><th>{t('d.per100')}</th></tr></thead>
                <tbody>{b.drivers.filter((x) => x.score !== null).slice(0, 8).map((x) => (
                  <tr key={x.id}><td><b>{x.name}</b></td>
                    <td><span className="scorecell"><span className="smeter"><span style={{ width: `${x.score}%`, background: bandColor(x.score!) }} /></span><b>{x.score}</b><span className="muted small">{bandLabel(x.score!)}</span></span></td>
                    <td>{fmtNum(x.km, 0)} km</td><td>{x.events}</td><td>{x.per100km === null ? '—' : fmtNum(x.per100km, 1)}</td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
        </div>
      </Section>

      {/* ---------- Fuel ---------- */}
      <Section title={t('d.fuel')} note={t('d.fuelNote')}>
        <div className="grid kpis">
          <Kpi label={t('d.fuelCost')} value={fmtInr(f.cost)} />
          <Kpi label={t('d.fuelLitres')} value={compact(f.litres)} unit="L" />
          <Kpi label={t('d.costKm')} value={f.cost_per_km === null ? '—' : fmtInr(f.cost_per_km)} />
          <Kpi label={t('d.kmL')} value={f.avg_km_per_litre === null ? '—' : fmtNum(f.avg_km_per_litre, 1)} unit="km/L" />
          <Kpi label={t('d.idleWaste')} value={fmtInr(f.idle_cost)} sub={`${fmtNum(f.idle_share_pct, 0)}% · ${fmtNum(f.idle_litres, 0)} L`} />
        </div>
        <div className="grid cards">
          <Card title={t('d.dailyFuel')} span={2}>
            <div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={f.daily} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              {grid}{xDay}<YAxis tickFormatter={compact} tick={AX} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<Tip fmtLabel={fmtDay} rows={(p: any) => [{ name: t('d.fuelCost'), text: fmtInr(p[0].value), color: 'var(--s1)' }]} />} />
              <Bar dataKey="cost" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart></ResponsiveContainer></div>
          </Card>
          <Card title={t('d.driveIdle')}>
            <Segmented ariaLabel={t('d.driveIdle')} fmt={fmtInr} parts={[
              { key: 'drive', label: t('d.driving'), value: Math.max(0, f.cost - f.idle_cost), color: 'var(--s1)' },
              { key: 'idleF', label: t('d.idling'), value: f.idle_cost, color: 'var(--s2)' },
            ]} />
          </Card>
          <Card title={t('d.fuelVeh')} span={2}>
            <Ranked rows={f.by_vehicle.map((x) => ({ key: x.id, label: x.reg, value: x.cost }))} fmt={fmtInr} empty={t('d.noData')} />
          </Card>
          <Card title={t('d.fuelType')}>
            {fuelTypeSlices.length === 0 ? empty : (
              <div className="donut-row">
                <div className="donut"><ResponsiveContainer width="100%" height="100%"><PieChart>
                  <Pie data={fuelTypeSlices} dataKey="value" nameKey="label" innerRadius="64%" outerRadius="100%" paddingAngle={fuelTypeSlices.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>{fuelTypeSlices.map((s) => <Cell key={s.key} fill={s.color} />)}</Pie>
                  <Tooltip content={<Tip rows={(p: any) => p.map((x: any) => ({ name: x.name, text: fmtInr(x.value), color: x.payload.color }))} />} />
                </PieChart></ResponsiveContainer><div className="donut-c"><b>{compact(f.cost)}</b><span>₹</span></div></div>
                <DonutLegend slices={fuelTypeSlices} fmt={fmtInr} centre={fmtInr(f.cost)} centreLabel={t('d.fuelCost')} />
              </div>
            )}
          </Card>
        </div>
      </Section>
    </div>
  );
}
