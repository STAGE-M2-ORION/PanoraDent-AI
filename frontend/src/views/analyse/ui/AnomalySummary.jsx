import { TypeMark, anomalyTypology, detectionType, typeTooltip } from "@/entities/detection";

import { QUADRANTS } from "../model/summary";

/**
 * Résumé des anomalies retenues, par type (rangés par urgence) et par
 * quadrant (sprint 7). Chaque case est un filtre de la liste : un clic sur un
 * compte filtre ce type dans ce quadrant, sur un type ou un quadrant filtre
 * toute la ligne ou la colonne ; un second clic retire le filtre.
 */
export function AnomalySummary({ summary, filters, onFilter }) {
  const { quadrant, type } = filters;
  const toggle = (next) => onFilter(next.type === type && next.quadrant === quadrant ? { type: null, quadrant: null } : next);
  return (
    <div className="sumbox">
      <table className="sumtab">
        <caption>
          Anomalies retenues : {summary.total} <span className="muted-sm">· au-dessus du seuil, hors rejetées · types rangés par urgence</span>
        </caption>
        <thead>
          <tr>
            <th scope="col">Type</th>
            {QUADRANTS.map(({ q, short, label }) => (
              <th key={q} scope="col">
                <button
                  type="button"
                  className="sumcell"
                  aria-pressed={quadrant === q && !type}
                  title={`Filtrer la liste : quadrant ${q}, ${label}`}
                  aria-label={`Quadrant ${q}, ${label} : ${summary.byQuadrant[q]} anomalie${summary.byQuadrant[q] > 1 ? "s" : ""}`}
                  onClick={() => toggle({ type: null, quadrant: q })}
                >
                  {short}
                </button>
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((r) => {
            const name = detectionType(r.label).label;
            return (
              <tr key={r.label}>
                <th scope="row">
                  <button type="button" className="sumcell sumtype" aria-pressed={type === r.label && !quadrant} title={`Filtrer la liste : ${typeTooltip(r.label)}`} onClick={() => toggle({ type: r.label, quadrant: null })}>
                    <TypeMark label={r.label} />
                    <span className="abbr" aria-hidden="true">
                      {detectionType(r.label).abbr}
                    </span>
                    <span className="sr-only">
                      {name}, urgence indicative : {anomalyTypology(r.label).urgencyText}
                    </span>
                  </button>
                </th>
                {QUADRANTS.map(({ q, label }) => (
                  <td key={q}>
                    {r.counts[q] ? (
                      <button
                        type="button"
                        className="sumcell n"
                        aria-pressed={type === r.label && quadrant === q}
                        aria-label={`${name}, quadrant ${q} (${label}) : ${r.counts[q]}. Filtrer la liste.`}
                        onClick={() => toggle({ type: r.label, quadrant: q })}
                      >
                        {r.counts[q]}
                      </button>
                    ) : (
                      <span className="zero" aria-label={`${name}, quadrant ${q} : aucune`}>
                        ·
                      </span>
                    )}
                  </td>
                ))}
                <td className="tot">
                  {r.total}
                  {r.unnumbered ? (
                    <span className="muted-sm" title="Sans numéro de dent valide">
                      {" "}
                      ({r.unnumbered} s.&nbsp;n.)
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
