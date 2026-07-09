import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.tsx';

// 13 ekrana (spec §3); za sada su aktivni Dashboard + placeholderi.
const NAV = [
  { to: '/', label: 'Početna', end: true },
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

  async function onLogout(): Promise<void> {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-logo">K</span>
          <span className="sidebar-name">Karton</span>
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
