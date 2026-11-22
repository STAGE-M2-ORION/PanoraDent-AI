import { markPath } from "../lib/marks";
import { detectionType, typeTooltip } from "../model/detection";

/** Carré de couleur d'une classe (toujours accompagné de son nom ailleurs). */
export function DetSwatch({ label, filled, style }) {
  const type = detectionType(label);
  return <span className={`det-swatch ${type.cls}`} style={filled ? { background: "currentColor", ...style } : style} aria-hidden="true" />;
}

/** Marque d'un type d'anomalie (forme + couleur), décorative : le nom l'accompagne. */
export function TypeMark({ label, size = 12 }) {
  const r = size / 2 - 1.5;
  return (
    <svg className="type-mark" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <path d={markPath(label, size / 2, size / 2, r)} fill={detectionType(label).color} stroke="#0B1220" strokeWidth="1" />
    </svg>
  );
}

/** Abréviation de type + pastille, nom complet pour les lecteurs d'écran. */
export function TypeChip({ label }) {
  const type = detectionType(label);
  return (
    <span className="type-chip" title={typeTooltip(label)}>
      <span className={`det-swatch ${type.cls}`} aria-hidden="true" />
      <span aria-hidden="true">{type.abbr}</span>
      <span className="sr-only">{type.label}</span>
    </span>
  );
}
