import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './auth';
import { api } from './api';
import { LANGUAGES } from './i18n';
import Login from './pages/Login';
import Live from './pages/Live';
import History from './pages/History';
import { Vehicles, Drivers, Devices } from './pages/Masters';

function Shell() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const setLang = (code: string) => { i18n.changeLanguage(code); api('/api/auth/me', { method: 'PATCH', body: { locale: code } }).catch(() => {}); };
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">▲ {t('app.name')}</div>
        <nav>
          <NavLink to="/live">{t('nav.live')}</NavLink>
          <NavLink to="/history">{t('nav.history')}</NavLink>
          <NavLink to="/vehicles">{t('nav.vehicles')}</NavLink>
          <NavLink to="/drivers">{t('nav.drivers')}</NavLink>
          <NavLink to="/devices">{t('nav.devices')}</NavLink>
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
          <Route path="/live" element={<Live />} />
          <Route path="/history" element={<History />} />
          <Route path="/vehicles" element={<Vehicles />} />
          <Route path="/drivers" element={<Drivers />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="*" element={<Navigate to="/live" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/live" replace /> : <Login />} />
      <Route path="/*" element={user ? <Shell /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
