import { detectionType } from "@/entities/detection";

import { STATUS_LABEL, isDashed } from "@/widgets/analysis-workspace";

const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

function Glyph({ k, upper, color = "#94A3B8" }) {
  const molar = k >= 6;
  const w = molar ? 14 : k >= 4 ? 11 : 9;
  return (
    <svg viewBox="0 0 16 18" aria-hidden="true" style={{ color }}>
      {molar ? (
        <path
          d={`M${8 - w / 2 + 2} ${upper ? 10 : 8} L5 ${upper ? 1 : 17} M${8 + w / 2 - 2} ${upper ? 10 : 8} L11 ${upper ? 1 : 17}`}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ) : (
        <path d={`M8 ${upper ? 10 : 8} L8 ${upper ? 1 : 17}`} stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      )}
      <rect x={8 - w / 2} y={upper ? 10 : 1} width={w} height="7" rx="2" fill="currentColor" opacity=".9" />
    </svg>
  );
}

/** Schéma dentaire FDI : un clic sur une dent la retrouve sur l'image et dans la liste. */
export function Odontogram({ present, dets, selectedTooth, onPick }) {
  const cell = (fdi, mid) => {
    const k = fdi % 10;
    const upper = fdi < 30;
    if (!present.has(fdi)) {
      return (
        <div key={fdi} className={`tcell absent${mid ? " mid" : ""}`} aria-label={`Dent ${fdi} : non détectée`}>
          <span className="num">{fdi}</span>
          <Glyph k={k} upper={upper} color="#334155" />
          <span style={{ fontSize: 9, color: "var(--color-viewer-muted)" }}>absente</span>
        </div>
      );
    }
    const ds = dets.filter((d) => d.fdi === fdi);
    const allOk = ds.length > 0 && ds.every((d) => d.status !== "pending");
    const label = `Dent ${fdi}${ds.length ? ` : ${ds.map((d) => `${detectionType(d.label).label} (${STATUS_LABEL[d.status].toLowerCase()})`).join(", ")}` : " : aucune anomalie proposée"}`;
    const marks = (
      <span className="marks">
        {ds.map((d) => (
          <span
            key={d.id}
            className="mk"
            style={{ background: detectionType(d.label).color, ...(isDashed(d) ? { outline: "1px dashed #E2E8F0", outlineOffset: 1 } : null) }}
            title={detectionType(d.label).label}
          >
            {detectionType(d.label).abbr}
          </span>
        ))}
      </span>
    );
    return (
      <button key={fdi} type="button" className={`tcell${mid ? " mid" : ""}`} aria-pressed={selectedTooth === fdi} aria-label={label} title={label} onClick={() => onPick(fdi)}>
        {allOk ? (
          <svg className="ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="m5 12 5 5L20 7" />
          </svg>
        ) : null}
        {upper ? (
          <>
            <span className="num">{fdi}</span>
            <Glyph k={k} upper />
          </>
        ) : (
          <>
            <Glyph k={k} upper={false} />
            <span className="num">{fdi}</span>
          </>
        )}
        {marks}
      </button>
    );
  };
  return (
    <div className="odonto">
      <div className="odonto-head">
        <h3>Schéma dentaire (FDI)</h3>
        <p>Cliquez sur une dent pour la retrouver sur l&apos;image et dans la liste.</p>
      </div>
      <div className="arch" aria-label="Arcade supérieure">
        {UPPER.map((f, i) => cell(f, i === 8))}
      </div>
      <div className="arch" aria-label="Arcade inférieure">
        {LOWER.map((f, i) => cell(f, i === 8))}
      </div>
    </div>
  );
}
