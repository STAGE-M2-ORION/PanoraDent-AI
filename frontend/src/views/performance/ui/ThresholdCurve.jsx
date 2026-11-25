import { useState } from "react";

import { formatScore, formatShare } from "@/entities/model-version";

const W = 280;
const H = 220;
const M = { t: 14, r: 14, b: 38, l: 42 };
const IW = W - M.l - M.r;
const IH = H - M.t - M.b;
const X = (recall) => M.l + recall * IW;
const Y = (precision) => M.t + IH - precision * IH;
const TICKS = [0, 0.5, 1];

/**
 * Courbe précision-rappel d'UNE classe, mesurée sur la validation à quelques
 * seuils (petits multiples : un panneau par classe, une seule série, nommée
 * par son titre ; la couleur ne porte pas l'identité). Le seuil retenu est
 * cerclé et nommé. Survol ou focus d'un point : seuil, rappel, précision.
 */
export function ThresholdCurve({ item }) {
  const points = [...item.curve].sort((a, b) => a.recall - b.recall);
  const [hover, setHover] = useState(null);
  const shown = hover ?? item.curve.find((p) => p.threshold === item.chosen.threshold) ?? null;
  const path = points.map((p, i) => `${i ? "L" : "M"}${X(p.recall).toFixed(1)},${Y(p.precision).toFixed(1)}`).join(" ");

  return (
    <figure className="pr-panel">
      <figcaption>
        <strong>{item.label}</strong>
        <span className="pr-readout" aria-live="polite">
          {shown
            ? `Seuil ${formatScore(shown.threshold)} · rappel ${formatShare(shown.recall)} · précision ${formatShare(shown.precision)}`
            : "Survolez un point"}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${item.label} : précision selon le rappel, à ${points.length} seuils ; seuil retenu ${formatScore(item.chosen.threshold)}.`}
        onMouseLeave={() => setHover(null)}
      >
        {TICKS.map((t) => (
          <g key={t} className="pr-grid">
            <line x1={X(0)} x2={X(1)} y1={Y(t)} y2={Y(t)} />
            <text x={M.l - 6} y={Y(t) + 4} textAnchor="end">
              {formatScore(t)}
            </text>
            <line x1={X(t)} x2={X(t)} y1={Y(0)} y2={Y(1)} />
            <text x={X(t)} y={H - M.b + 16} textAnchor="middle">
              {formatScore(t)}
            </text>
          </g>
        ))}
        <text className="pr-axis" x={M.l + IW / 2} y={H - 4} textAnchor="middle">
          Rappel (anomalies retrouvées) →
        </text>
        <text className="pr-axis" x={12} y={M.t + IH / 2} textAnchor="middle" transform={`rotate(-90 12 ${M.t + IH / 2})`}>
          Précision →
        </text>
        <path className="pr-line" d={path} />
        {points.map((p) => {
          const chosen = p.threshold === item.chosen.threshold;
          return (
            <g
              key={p.threshold}
              className={chosen ? "pr-pt chosen" : "pr-pt"}
              tabIndex={0}
              onMouseEnter={() => setHover(p)}
              onFocus={() => setHover(p)}
              onBlur={() => setHover(null)}
            >
              <title>{`Seuil ${formatScore(p.threshold)} : rappel ${formatShare(p.recall)}, précision ${formatShare(p.precision)}`}</title>
              {/* Cible de survol plus large que la marque. */}
              <circle className="pr-hit" cx={X(p.recall)} cy={Y(p.precision)} r={12} />
              <circle cx={X(p.recall)} cy={Y(p.precision)} r={chosen ? 6 : 4} />
              {chosen ? (
                <text className="pr-label" x={X(p.recall)} y={Y(p.precision) + 20} textAnchor={p.recall > 0.75 ? "end" : "middle"}>
                  seuil retenu {formatScore(p.threshold)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
