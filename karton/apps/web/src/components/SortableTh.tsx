/** Zaglavlje kolone sa sortiranjem. Backend sortira nad celim skupom (spec §4.17). */
export function SortableTh({
  field,
  label,
  sort,
  onSort,
  right,
}: {
  field: string;
  label: string;
  sort: string | undefined;
  onSort: (next: string) => void;
  right?: boolean;
}): React.JSX.Element {
  const [f, dir] = (sort ?? '').split(':');
  const active = f === field;
  const nextDir = active && dir === 'asc' ? 'desc' : 'asc';
  return (
    <th
      className={`sortable ${right ? 'ta-r' : ''} ${active ? 'sorted' : ''}`}
      onClick={() => onSort(`${field}:${nextDir}`)}
      title={`Sortiraj po: ${label}`}
    >
      <span className="th-inner">
        {label}
        <span className="sort-ind">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </span>
    </th>
  );
}
