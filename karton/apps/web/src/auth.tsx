import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UserRole } from '@karton/shared';
import { api, ApiRequestError } from './api.ts';

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<CurrentUser | null>(null);

  // Sesija istekla ili ugašena (npr. posle vraćanja baze iz backupa) → nazad na prijavu.
  useEffect(() => {
    const onUnauthorized = (): void => setUser(null);
    window.addEventListener('karton:unauthorized', onUnauthorized);
    return () => window.removeEventListener('karton:unauthorized', onUnauthorized);
  }, []);
  const [loading, setLoading] = useState(true);

  // Pri učitavanju: proveri postojeću sesiju (i usput dobij XSRF-TOKEN kolačić).
  useEffect(() => {
    api
      .get<CurrentUser>('/auth/me')
      .then(setUser)
      .catch((err) => {
        if (!(err instanceof ApiRequestError && err.status === 401)) console.error(err);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string): Promise<void> {
    const u = await api.post<CurrentUser>('/auth/login', { email, password });
    setUser(u);
  }

  async function logout(): Promise<void> {
    await api.post('/auth/logout');
    setUser(null);
  }

  return <AuthContext value={{ user, loading, login, logout }}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth mora biti unutar <AuthProvider>');
  return ctx;
}
