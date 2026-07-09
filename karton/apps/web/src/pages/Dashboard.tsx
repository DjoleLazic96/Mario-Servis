import { useAuth } from '../auth.tsx';

/**
 * Placeholder početne (spec §3.1): tri celine — Danas / Posao / Novac.
 * Prava agregacija (GET /dashboard) dolazi kada budu nalozi i dokumenti.
 */
export function Dashboard(): React.JSX.Element {
  const { user } = useAuth();
  return (
    <div className="page">
      <header className="page-head">
        <h1>Početna</h1>
        <p className="page-sub">Dobrodošli, {user?.name}.</p>
      </header>

      <div className="card-grid">
        <section className="card">
          <h2 className="card-title">Danas</h2>
          <p className="card-empty">Termini i vozila koja čekaju delove — uskoro.</p>
        </section>
        <section className="card">
          <h2 className="card-title">Posao</h2>
          <p className="card-empty">Vozila u servisu, otvoreni nalozi, ponude — uskoro.</p>
        </section>
        <section className="card">
          <h2 className="card-title">Novac</h2>
          <p className="card-empty">Prihod meseca i nenaplaćeni računi — uskoro.</p>
        </section>
      </div>
    </div>
  );
}

/** Zajednički placeholder za ekrane koji tek dolaze. */
export function Placeholder({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="page">
      <header className="page-head">
        <h1>{title}</h1>
      </header>
      <div className="card">
        <p className="card-empty">Ovaj ekran je u izradi.</p>
      </div>
    </div>
  );
}
