import { useNavigate } from 'react-router-dom';
import type { DocumentChain } from '@karton/shared';

/**
 * Dvoredna dokument traka (spec §9): Posao (Ponuda · RN) / Naplata (Predračun · Račun).
 * Aktivna dugmad vode na entitet; onemogućena jasno pokazuju da dokument ne postoji.
 */
export function DocumentChainBar({ chain, currentId, onAddQuote }: {
  chain: DocumentChain;
  currentId: number;
  /** Kad je prosleđeno i „Ponuda" ne postoji, prazan kvadratić postaje dugme za vezivanje. */
  onAddQuote?: () => void;
}): React.JSX.Element {
  const navigate = useNavigate();

  const cell = (label: string, ref: { id: number; number: string; status: string } | null, to: (id: number) => string, onAdd?: () => void) => {
    if (!ref) {
      // Prazno + akcija (samo za „Ponuda" na nalogu u radu): kvadratić je klikabilan.
      if (onAdd) {
        return (
          <button type="button" className="chain-cell add" onClick={onAdd}>
            <span className="chain-label">{label}</span>
            <span className="chain-add">+ Veži ponudu</span>
          </button>
        );
      }
      return <div className="chain-cell empty"><span className="chain-label">{label}</span><span className="chain-none">—</span></div>;
    }
    const active = ref.id === currentId;
    return (
      <button className={`chain-cell ${active ? 'current' : ''}`} onClick={() => !active && navigate(to(ref.id))} disabled={active}>
        <span className="chain-label">{label}</span>
        <span className="chain-num mono">{ref.number}</span>
      </button>
    );
  };

  return (
    <div className="chain-bar">
      <div className="chain-group">
        <span className="chain-group-label">Posao</span>
        {cell('Ponuda', chain.quote, (id) => `/dokumenti/${id}`, onAddQuote)}
        {cell('Radni nalog', chain.workOrder, (id) => `/nalozi/${id}`)}
      </div>
      <div className="chain-group">
        <span className="chain-group-label">Naplata</span>
        {cell('Predračun', chain.proforma, (id) => `/dokumenti/${id}`)}
        {cell('Račun', chain.invoice, (id) => `/dokumenti/${id}`)}
      </div>
    </div>
  );
}
