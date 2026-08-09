import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { api } from '../api.ts';

/** Dok se Podešavanja ne učitaju — i na prijavi, koja ih ne sme čitati (nema sesije). */
export const APP_NAME = 'AUTO SERVIS S23';

// Glavna navigacija; Podešavanja se dodaju samo adminu (ADMIN_NAV niže).
interface NavItem { to: string; label: string; end?: boolean }
const NAV: NavItem[] = [
  { to: '/', label: 'Početna', end: true },
  { to: '/nezavrseni', label: 'Monitoring' },
  { to: '/klijenti', label: 'Klijenti' },
  { to: '/vozila', label: 'Vozila' },
  { to: '/nalozi', label: 'Radni nalozi' },
  { to: '/reklamacije', label: 'Reklamacije' },
  { to: '/kalendar', label: 'Kalendar' },
  { to: '/dokumenti', label: 'Dokumenti' },
  { to: '/cenovnik', label: 'Cenovnik' },
  { to: '/izvestaji', label: 'Izveštaji' },
];

const ADMIN_NAV: NavItem[] = [{ to: '/podesavanja', label: 'Podešavanja' }];

// Donja navigacija (mobilni) — pet najčešćih; „Više" otvara fioku sa celim menijem.
const ICONS: Record<string, React.JSX.Element> = {
  home: <path d="M3 10.5 12 3l9 7.5V21H3z" />,
  order: <><path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 9h6M9 13h4" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  users: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
};

function Icon({ name }: { name: keyof typeof ICONS }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

export function Layout(): React.JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Ime aplikacije = naziv servisa iz Podešavanja: kad Mario promeni naziv, traka ga prati.
  const [shopName, setShopName] = useState(APP_NAME);
  // „Hamburger" fioka (mobilni).
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Sklapanje bočnog menija (samo desktop) — stanje se pamti između poseta.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === '1');
  function toggleCollapsed(): void {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem('sidebar-collapsed', next ? '1' : '0');
      return next;
    });
  }

  useEffect(() => {
    void api.get<{ shopName: string }>('/settings')
      .then((s) => { if (s.shopName) setShopName(s.shopName); })
      .catch(() => { /* ostaje podrazumevano ime */ });
  }, []);

  // Fioka se zatvara na promenu strane, na Escape i kad se pređe na desktop.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [drawerOpen]);

  async function onLogout(): Promise<void> {
    await logout();
    navigate('/login', { replace: true });
  }

  const role = user?.role === 'admin' ? 'Administrator' : 'Korisnik';
  const navItems = user?.role === 'admin' ? [...NAV, ...ADMIN_NAV] : NAV;
  const linkClass = ({ isActive }: { isActive: boolean }): string => 'nav-link' + (isActive ? ' active' : '');

  return (
    <div className={`app-shell${collapsed ? ' nav-collapsed' : ''}`}>
      {/* ── Bočni meni (desktop ≥1024px) ── */}
      <aside className="sidebar">
        <div className="side-top">
          <button className="side-brand" onClick={() => navigate('/')} title="Početna">
            <img className="sidebar-logo" src="/icon-192.png" alt="" />
            <span>{shopName}</span>
          </button>
          <button className="side-collapse" onClick={toggleCollapsed} title="Sakrij meni" aria-label="Sakrij meni">‹</button>
        </div>
        <nav className="side-nav">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
          <div className="drawer-sep" />
          <button className="nav-link odjava" onClick={onLogout}>Odjava</button>
        </nav>
        <div className="side-user">
          <b>{user?.name}</b>
          {role}
        </div>
      </aside>
      {/* „☰" za vraćanje sklopljenog menija — vidi se samo na desktopu kad je sklopljen. */}
      <button className="nav-reopen" onClick={toggleCollapsed} title="Prikaži meni" aria-label="Prikaži meni">☰</button>

      {/* ── Gornja traka (mobilni <1024px) ── */}
      <header className="app-header">
        <img className="sidebar-logo" src="/icon-192.png" alt="" />
        <button className="hdr-brand" onClick={() => navigate('/')} title="Početna">{shopName}</button>
        <div className="user-chip"><b>{user?.name}</b>{role}</div>
        <button className="burger" aria-label="Meni" onClick={() => setDrawerOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </header>
      <div className="hazard" />

      {/* ── Fioka (mobilni) ── */}
      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-bg" onClick={() => setDrawerOpen(false)} />
        <div className="drawer-panel" role="dialog" aria-label="Meni">
          <div className="drawer-head">
            <span>{shopName}</span>
            <button className="drawer-close" aria-label="Zatvori" onClick={() => setDrawerOpen(false)}>×</button>
          </div>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
          <div className="drawer-sep" />
          <button className="nav-link odjava" onClick={onLogout}>Odjava</button>
        </div>
      </div>

      <main className="app-main">
        <Outlet />
      </main>

      {/* ── Donja navigacija (mobilni) ── */}
      <nav className="bottom">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : undefined)}><Icon name="home" />Početna</NavLink>
        <NavLink to="/nalozi" className={({ isActive }) => (isActive ? 'active' : undefined)}><Icon name="order" />Nalozi</NavLink>
        <NavLink to="/kalendar" className={({ isActive }) => (isActive ? 'active' : undefined)}><Icon name="calendar" />Kalendar</NavLink>
        <NavLink to="/klijenti" className={({ isActive }) => (isActive ? 'active' : undefined)}><Icon name="users" />Klijenti</NavLink>
        <button onClick={() => setDrawerOpen(true)}><Icon name="more" />Više</button>
      </nav>
    </div>
  );
}
