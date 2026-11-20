import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import i18n from './i18n';

export interface User { id: string; name: string; email: string; role: string; locale: string }
const Ctx = createContext<{ user: User | null; ready: boolean; login(t: string, u: User): void; logout(): void }>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!getToken());
  useEffect(() => {
    if (!getToken()) return;
    api<User>('/api/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  const login = (t: string, u: User) => { setToken(t); setUser(u); if (u.locale) i18n.changeLanguage(u.locale); };
  const logout = () => { setToken(null); setUser(null); };
  return <Ctx.Provider value={{ user, ready, login, logout }}>{children}</Ctx.Provider>;
}
