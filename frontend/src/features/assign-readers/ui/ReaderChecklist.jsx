/**
 * Lecteurs à qui confier une analyse : une case par compte. Sans lecteur
 * dans le cabinet, un simple message (l'administrateur en crée un).
 */
export function ReaderChecklist({ readers, selected, onChange, disabled = false, legend = "Confier à un lecteur" }) {
  const toggle = (id, on) => onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  return (
    <fieldset className="choices" data-lecteurs disabled={disabled}>
      <legend>{legend}</legend>
      {readers.length ? (
        readers.map((r) => (
          <label key={r.id} className="check">
            <input type="checkbox" checked={selected.includes(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
            {r.name}
            {r.name !== r.email ? <span className="hint"> · {r.email}</span> : null}
          </label>
        ))
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          Aucun compte lecteur dans le cabinet : l’administrateur peut en créer un.
        </p>
      )}
    </fieldset>
  );
}
