import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../auth';
import { LANGUAGES } from '../i18n';

export default function Login() {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const [signup, setSignup] = useState(false);
  const [f, setF] = useState({ email: '', password: '', name: '', orgName: '' });
  const [err, setErr] = useState('');
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    try {
      const r = await api(signup ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body: signup ? { ...f, locale: i18n.language.split('-')[0] } : { email: f.email, password: f.password } });
      login(r.token, r.user);
    } catch (e: any) {
      setErr(e.status === 400 && e.body?.issues ? e.body.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ') : e.status === 409 ? 'Email already registered' : t('auth.error'));
    }
  }
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand big">▲ {t('app.name')}</div>
        {signup && <>
          <label>{t('auth.org')}<input required value={f.orgName} onChange={set('orgName')} /></label>
          <label>{t('auth.name')}<input required value={f.name} onChange={set('name')} /></label>
        </>}
        <label>{t('auth.email')}<input type="email" required value={f.email} onChange={set('email')} autoComplete="username" /></label>
        <label>{t('auth.password')}<input type="password" required minLength={signup ? 8 : 1} value={f.password} onChange={set('password')} autoComplete={signup ? 'new-password' : 'current-password'} /></label>
        {err && <div className="error">{err}</div>}
        <button className="primary">{signup ? t('auth.signup') : t('auth.login')}</button>
        <button type="button" className="link" onClick={() => setSignup(!signup)}>{signup ? t('auth.toLogin') : t('auth.toSignup')}</button>
        <select aria-label={t('c.language')} value={i18n.language.split('-')[0]} onChange={(e) => i18n.changeLanguage(e.target.value)}>
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </form>
    </div>
  );
}
