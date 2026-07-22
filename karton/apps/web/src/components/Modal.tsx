import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Modalni pop-up sa scrollom (spec §2: sve forme su modali, mogu biti ugnježdene).
 * Zatvara se na Escape i klik van kartice.
 *
 * Renderuje se kroz PORTAL u <body>, a ne tamo gde je pozvan. Bez toga, modal otvoren
 * IZ neke forme (npr. „+ Novo vozilo" iz radnog naloga) završi kao <form> unutar <form> —
 * što HTML ne dozvoljava: dugme „Sačuvaj" tada okida spoljnu formu i sve pukne.
 * Portal izmešta sadržaj van forme, pa se ugnježdeni modali-forme ponašaju ispravno.
 */
export function Modal({
  title,
  onClose,
  children,
  width = 460,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Zatvori">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
