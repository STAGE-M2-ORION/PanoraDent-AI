import { detectionType } from "../model/detection";

/** Carré de couleur d'une classe (toujours accompagné de son nom ailleurs). */
export function DetSwatch({ label, filled, style }) {
  const type = detectionType(label);
  return <span className={`det-swatch ${type.cls}`} style={filled ? { background: "currentColor", ...style } : style} aria-hidden="true" />;
}

/** Abréviation de type + pastille, nom complet pour les lecteurs d'écran. */
export function TypeChip({ label }) {
  const type = detectionType(label);
  return (
    <span className="type-chip" title={type.label}>
      <span className={`det-swatch ${type.cls}`} aria-hidden="true" />
      <span aria-hidden="true">{type.abbr}</span>
      <span className="sr-only">{type.label}</span>
    </span>
  );
}
