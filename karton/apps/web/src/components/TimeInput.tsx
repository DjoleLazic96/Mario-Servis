/**
 * Vreme u 24-časovnom formatu (HH:MM).
 * Ne koristimo <input type="time"> jer ga browser prikazuje po SVOJOJ lokalizaciji
 * (na en-US pokazuje AM/PM). Ovde je format uvek srpski, bez obzira na browser.
 */
export function TimeInput({
  value,
  onChange,
  required,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  id?: string;
}): React.JSX.Element {
  function handle(raw: string): void {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) { onChange(digits); return; }
    onChange(`${digits.slice(0, 2)}:${digits.slice(2)}`);
  }

  function blur(): void {
    const m = /^(\d{1,2}):?(\d{0,2})$/.exec(value.trim());
    if (!m) return;
    let h = Math.min(23, parseInt(m[1] ?? '0', 10));
    let mi = Math.min(59, parseInt(m[2] || '0', 10));
    if (Number.isNaN(h)) h = 0;
    if (Number.isNaN(mi)) mi = 0;
    onChange(`${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`);
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      className="time-input"
      placeholder="HH:MM"
      maxLength={5}
      value={value}
      onChange={(e) => handle(e.target.value)}
      onBlur={blur}
      required={required}
      pattern="^([01]\d|2[0-3]):[0-5]\d$"
      title="Format: HH:MM (24h), npr. 14:30"
    />
  );
}
