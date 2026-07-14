import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { ApiRequestError } from '../api.ts';

export function Login(): React.JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Odredište posle prijave (npr. QR sa štampe vodi na /nalozi/42 → redirect nazad).
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : 'Greška pri prijavi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <img className="login-logo" src="/logo.png" alt="AUTO SERVIS S23" />
          <div>
            <div className="login-title">Karton</div>
            <div className="login-sub">Vođenje auto servisa</div>
          </div>
        </div>

        <label className="field">
          <span>Korisnik</span>
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span>Lozinka</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <div className="login-error">{error}</div>}

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Prijava…' : 'Prijavi se'}
        </button>
      </form>
    </div>
  );
}
