import { Suspense, lazy, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './auth';
import { api } from './api';
import { LANGUAGES } from './i18n';
import Login from './pages/Login';
const Dashboard = lazy(() => import('./pages/Dashboard')); // charts library is only loaded when needed
import Live from './pages/Live';
import History from './pages/History';
import { Vehicles, Drivers, Devices } from './pages/Masters';
import Trips from './pages/Trips';
import AssistantChat from './pages/AssistantChat';

const MASTER_PATHS = ['/vehicles', '/drivers', '/devices', '/trips'];

/** Collapsible "Masters" menu: Vehicles, Drivers, Devices, Trips. Opens automatically on those routes. */
function MastersMenu() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const inMasters = MASTER_PATHS.some((p) => pathname.startsWith(p));
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('veyro.mastersOpen') !== '0'; } catch { return true; } });
  useEffect(() => { if (inMasters) setOpen(true); }, [inMasters]);
  const toggle = () => { const n = !open; setOpen(n); try { localStorage.setItem('veyro.mastersOpen', n ? '1' : '0'); } catch { /* ignore */ } };
  return (
    <div className="navgroup">
      <button className={`navhead ${inMasters ? 'has-active' : ''}`} aria-expanded={open} aria-controls="masters-sub" onClick={toggle}>
        <span>{t('nav.masters')}</span><span className="chev" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="navsub" id="masters-sub">
          <NavLink to="/vehicles">{t('nav.vehicles')}</NavLink>
          <NavLink to="/drivers">{t('nav.drivers')}</NavLink>
          <NavLink to="/devices">{t('nav.devices')}</NavLink>
          <NavLink to="/trips">{t('nav.trips')}</NavLink>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const setLang = (code: string) => { i18n.changeLanguage(code); api('/api/auth/me', { method: 'PATCH', body: { locale: code } }).catch(() => {}); };
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">▲ {t('app.name')}</div>
        <nav>
          <NavLink to="/dashboard">{t('nav.dashboard')}</NavLink>
          <NavLink to="/live">{t('nav.live')}</NavLink>
          <NavLink to="/history">{t('nav.history')}</NavLink>
          <MastersMenu />
        </nav>
        <div className="side-foot">
          <select aria-label={t('c.language')} value={i18n.language.split('-')[0]} onChange={(e) => setLang(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <div className="muted">{user?.name}</div>
          <button className="link" onClick={logout}>{t('nav.logout')}</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/dashboard" element={<Suspense fallback={null}><Dashboard /></Suspense>} />
          <Route path="/live" element={<Live />} />
          <Route path="/history" element={<History />} />
          <Route path="/vehicles" element={<Vehicles />} />
          <Route path="/drivers" element={<Drivers />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/trips" element={<Trips />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      <AssistantChat />
    </div>
  );
}

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/*" element={user ? <Shell /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
