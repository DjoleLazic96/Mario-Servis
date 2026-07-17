import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { api } from '../api.ts';

/** Dok se Podešavanja ne učitaju — i na prijavi, koja ih ne sme čitati (nema sesije). */
export const APP_NAME = 'AUTO SERVIS S23';

// Glavna navigacija; Podešavanja se dodaju samo adminu (ADMIN_NAV niže).
const NAV = [
  { to: '/', label: 'Početna', end: true },
  { to: '/nezavrseni', label: 'Nezavršeni' },
  { to: '/klijenti', label: 'Klijenti' },
  { to: '/vozila', label: 'Vozila' },
  { to: '/nalozi', label: 'Radni nalozi' },
  { to: '/kalendar', label: 'Kalendar' },
  { to: '/dokumenti', label: 'Dokumenti' },
  { to: '/cenovnik', label: 'Cenovnik' },
  { to: '/izvestaji', label: 'Izveštaji' },
];

const ADMIN_NAV = [{ to: '/podesavanja', label: 'Podešavanja' }];

export function Layout(): React.JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Ime aplikacije = naziv servisa iz Podešavanja: kad Mario promeni naziv, traka ga prati.
  const [shopName, setShopName] = useState(APP_NAME);
  useEffect(() => {
    void api.get<{ shopName: string }>('/settings')
      .then((s) => { if (s.shopName) setShopName(s.shopName); })
      .catch(() => { /* ostaje podrazumevano ime */ });
  }, []);

  async function onLogout(): Promise<void> {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img className="sidebar-logo" src="/icon-192.png" alt="" />
          <span className="sidebar-name">{shopName}</span>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="nav-item">
              {item.label}
            </NavLink>
          ))}
          {user?.role === 'admin' &&
            ADMIN_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className="nav-item">
                {item.label}
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-user">
            <div className="sidebar-user-name">{user?.name}</div>
            <div className="sidebar-user-role">{user?.role === 'admin' ? 'Administrator' : 'Korisnik'}</div>
          </div>
          <button className="btn-ghost" onClick={onLogout}>
            Odjava
          </button>
        </div>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
