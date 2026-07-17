import { useState } from 'react';

/**
 * Polje za lozinku sa okom za prikaz/skrivanje.
 *
 * Bez ovoga se lozinka kuca naslepo — pri prijavi na tuđem računaru ili pri postavljanju
 * lozinke korisniku lako se omakne, a ne vidiš šta si otkucao. Oko prebacuje text↔password.
 *
 * Prosleđuje sve što treba običnom <input>-u (autoComplete, required, minLength, autoFocus…),
 * pa se koristi kao zamena za `<input type="password">`.
 */
export function PasswordInput({
  value, onChange, autoComplete, required, minLength, autoFocus, placeholder, id,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  autoFocus?: boolean;
  placeholder?: string;
  id?: string;
}): React.JSX.Element {
  const [shown, setShown] = useState(false);
  return (
    <div className="pw-field">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        autoFocus={autoFocus}
        placeholder={placeholder}
      />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Sakrij lozinku' : 'Prikaži lozinku'}
        title={shown ? 'Sakrij lozinku' : 'Prikaži lozinku'}
        tabIndex={-1}
      >
        {shown ? '🙈' : '👁'}
      </button>
    </div>
  );
}
