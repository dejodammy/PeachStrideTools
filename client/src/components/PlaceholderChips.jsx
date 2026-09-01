export default function PlaceholderChips({ columns, onInsert, emptyHint }) {
  if (!columns || columns.length === 0) {
    return emptyHint ? <p className="chip-row-empty">{emptyHint}</p> : null;
  }
  return (
    <div className="chip-row">
      <span className="chip-row-label">Insert field</span>
      {columns.map((col) => (
        <button type="button" key={col} className="chip" onClick={() => onInsert(col)} title={`Insert ${col}`}>
          {col}
        </button>
      ))}
    </div>
  );
}
