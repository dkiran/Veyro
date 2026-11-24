import type { ReactNode } from 'react';
import { fmtNum } from '../i18n';
import i18n from '../i18n';

export const fmtDay = (iso: string) => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(new Date(iso + 'T00:00:00'));
export const fmtInr = (n: number) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
export const compact = (n: number) => new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="dsec">
      <h2 className="dsec-title">{title}</h2>
      {note && <p className="dnote">{note}</p>}
      {children}
    </section>
  );
}

export function Card({ title, sub, children, span = 1, right }: { title: string; sub?: string; children: ReactNode; span?: 1 | 2 | 3; right?: ReactNode }) {
  return (
    <div className={`dcard span${span}`}>
      <div className="dcard-head"><div><h3>{title}</h3>{sub && <div className="dsub">{sub}</div>}</div>{right}</div>
      {children}
    </div>
  );
}

export function Delta({ pct, upGood = true, label }: { pct: number | null; upGood?: boolean; label: string }) {
  if (pct === null || pct === undefined) return null;
  const up = pct >= 0, good = pct === 0 ? true : up === upGood;
  return <span className={`delta ${good ? 'good' : 'bad'}`} title={label}>{up ? '▲' : '▼'} {fmtNum(Math.abs(pct), 1)}%</span>;
}

export function Kpi({ label, value, unit, sub, delta }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; delta?: ReactNode }) {
  return (
    <div className="dcard kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}{unit && <span className="kpi-unit"> {unit}</span>}</div>
      <div className="kpi-sub">{delta}{sub && <span>{sub}</span>}</div>
    </div>
  );
}

const ICONS: Record<string, ReactNode> = {
  total: <path d="M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z" />,
  running: <path d="M7 4l13 8-13 8z" />,
  idle: <path d="M7 4h4v16H7zM13 4h4v16h-4z" />,
  stopped: <path d="M6 6h12v12H6z" />,
  nogps: <><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M6.5 17.5l11-11" stroke="currentColor" strokeWidth="2.4" fill="none" /></>,
};
export function StatusTile({ kind, label, value, share, color, foot }: { kind: keyof typeof ICONS; label: string; value: number; share?: string; color: string; foot?: string }) {
  return (
    <div className="dcard stile" style={{ ['--c' as any]: color }}>
      <div className="stile-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">{ICONS[kind]}</svg></div>
      <div>
        <div className="kpi-label">{label}</div>
        <div className="stile-value">{fmtNum(value, 0)}</div>
        <div className="kpi-sub"><span>{share ?? foot}</span></div>
      </div>
    </div>
  );
}

/** Donut with centre total and an HTML legend (name, value, share). Identity never relies on colour alone. */
export interface Slice { key: string; label: string; value: number; color: string }
export function DonutLegend({ slices, centre, centreLabel, fmt = (n: number) => fmtNum(n, 0) }: { slices: Slice[]; centre: string; centreLabel: string; fmt?: (n: number) => string }) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <ul className="legend">
      {slices.map((s) => (
        <li key={s.key}><i style={{ background: s.color }} /><span className="lname">{s.label}</span><b>{fmt(s.value)}</b><span className="muted small lpct">{fmtNum((s.value / total) * 100, 0)}%</span></li>
      ))}
      <li className="ltot"><span className="lname muted">{centreLabel}</span><b>{centre}</b></li>
    </ul>
  );
}

/** Tall segmented bar: one whole split into <=6 parts, share printed inside where it fits. */
export function Segmented({ parts, fmt, ariaLabel }: { parts: Slice[]; fmt: (n: number) => string; ariaLabel: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className="seg" role="img" aria-label={`${ariaLabel}: ${parts.map((p) => `${p.label} ${fmt(p.value)}`).join(', ')}`}>
        {parts.filter((p) => p.value > 0).map((p) => {
          const pct = (p.value / total) * 100;
          return <div key={p.key} className="seg-part" style={{ flexGrow: p.value, background: p.color, color: p.key === 'warn' ? '#0b0b0b' : '#fff' }} title={`${p.label}: ${fmt(p.value)} (${fmtNum(pct, 0)}%)`}>{pct >= 12 ? `${fmtNum(pct, 0)}%` : ''}</div>;
        })}
      </div>
      <ul className="legend row">
        {parts.map((p) => <li key={p.key}><i style={{ background: p.color }} /><span className="lname">{p.label}</span><b>{fmt(p.value)}</b></li>)}
      </ul>
    </div>
  );
}

/** Ranked horizontal bars, one hue, value at the tip. */
export function Ranked({ rows, fmt, color = 'var(--s1)', empty }: { rows: { key: string; label: string; value: number }[]; fmt: (n: number) => string; color?: string; empty: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length) return <div className="muted pad">{empty}</div>;
  return (
    <ul className="ranked">
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${fmt(r.value)}`}>
          <span className="rname">{r.label}</span>
          <span className="rtrack"><span className="rfill" style={{ width: `${(r.value / max) * 100}%`, background: color }} /></span>
          <b className="rval">{fmt(r.value)}</b>
        </li>
      ))}
    </ul>
  );
}

export function Tip({ active, payload, label, fmtLabel, rows }: any) {
  if (!active || !payload?.length) return null;
  const items = rows ? rows(payload) : payload.map((p: any) => ({ name: p.name, value: p.value, color: p.color ?? p.fill ?? p.payload?.fill }));
  return (
    <div className="ctip">
      {label !== undefined && <div className="ctip-h">{fmtLabel ? fmtLabel(label) : label}</div>}
      {items.map((it: any, i: number) => (
        <div key={i} className="ctip-r"><i style={{ background: it.color }} /><span>{it.name}</span><b>{it.text ?? fmtNum(it.value, 1)}</b></div>
      ))}
    </div>
  );
}
