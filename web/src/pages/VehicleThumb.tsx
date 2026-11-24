import { useEffect, useState } from 'react';

const P = {
  truck: <><rect x="2" y="7" width="28" height="17" rx="2" /><path d="M32 12h8l6 7v5H32z" /><circle cx="12" cy="27" r="4.2" stroke="var(--card)" strokeWidth="1.6" /><circle cx="38" cy="27" r="4.2" stroke="var(--card)" strokeWidth="1.6" /></>,
  bus: <><rect x="3" y="5" width="42" height="21" rx="4" /><rect x="7" y="9" width="8" height="7" rx="1" fill="var(--card)" /><rect x="18" y="9" width="8" height="7" rx="1" fill="var(--card)" /><rect x="29" y="9" width="8" height="7" rx="1" fill="var(--card)" /><circle cx="13" cy="27" r="4" stroke="var(--card)" strokeWidth="1.6" /><circle cx="35" cy="27" r="4" stroke="var(--card)" strokeWidth="1.6" /></>,
  car: <><path d="M4 22l3-8c.6-1.6 2-2.5 3.7-2.5h4.6L19 6.5c.6-.9 1.6-1.5 2.7-1.5h8.6c1.3 0 2.4.6 3.1 1.6l3.3 5H42c2.2 0 4 1.8 4 4V22z" /><circle cx="14" cy="24" r="4.2" stroke="var(--card)" strokeWidth="1.6" /><circle cx="36" cy="24" r="4.2" stroke="var(--card)" strokeWidth="1.6" /></>,
  van: <><path d="M2 8c0-1.7 1.3-3 3-3h22c1.2 0 2.2.6 2.8 1.6L35 12h7c2.2 0 4 1.8 4 4v8H2z" /><rect x="31" y="13" width="9" height="5" rx="1" fill="var(--card)" /><circle cx="13" cy="26" r="4.2" stroke="var(--card)" strokeWidth="1.6" /><circle cx="37" cy="26" r="4.2" stroke="var(--card)" strokeWidth="1.6" /></>,
  bike: <><circle cx="11" cy="23" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" /><circle cx="37" cy="23" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M11 23l8-10h9l9 10M19 13l-2-4h-4m15 4l4 10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></>,
  tractor: <><circle cx="14" cy="22" r="9" /><circle cx="14" cy="22" r="3.2" fill="var(--card)" /><circle cx="39" cy="26" r="5" /><path d="M20 8h13l4 10h5v5H24z" /><path d="M22 8h9v-3h-9z" /></>,
  other: <><path d="M24 4l17 8v16L24 36 7 28V12z" opacity=".9" /><path d="M24 4v32M7 12l17 8 17-8" fill="none" stroke="var(--card)" strokeWidth="1.8" /></>,
} as const;

export function VehicleIcon({ type, size = 26 }: { type?: string | null; size?: number }) {
  const key = (type && type in P ? type : 'other') as keyof typeof P;
  return <svg viewBox="0 0 48 34" width={size * 1.45} height={size} fill="currentColor" aria-hidden="true">{P[key]}</svg>;
}

/** Vehicle photo; falls back to a type icon when there is no URL or it fails to load. */
export default function VehicleThumb({ url, type, size = 'md' }: { url?: string | null; type?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) return <img className={`vthumb ${size}`} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  return <span className={`vthumb ${size} icon`}><VehicleIcon type={type} size={size === 'sm' ? 15 : size === 'lg' ? 34 : 24} /></span>;
}
