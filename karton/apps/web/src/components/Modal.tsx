import { useEffect, type ReactNode } from 'react';

/**
 * Modalni pop-up sa scrollom (spec §2: sve forme su modali, mogu biti ugnježdene).
 * Zatvara se na Escape i klik van kartice.
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

  return (
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
    </div>
  );
}
