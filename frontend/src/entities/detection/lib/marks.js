import { ANOMALY_TYPOLOGY } from "../model/detection";

/**
 * Tracé SVG (attribut `d`) de la marque d'un type d'anomalie, centrée en
 * (cx, cy), de demi-taille r. Une forme par type (rond, carré, losange,
 * triangle) : la marque reste lisible sans la couleur. Sert au schéma
 * dentaire, à sa légende, au résumé et à l'export en image.
 */
export function markPath(label, cx, cy, r) {
  const shape = ANOMALY_TYPOLOGY[label]?.shape ?? "circle";
  const f = (v) => Math.round(v * 100) / 100;
  if (shape === "square") {
    const s = r * 0.9;
    return `M${f(cx - s)} ${f(cy - s)}H${f(cx + s)}V${f(cy + s)}H${f(cx - s)}Z`;
  }
  if (shape === "diamond") {
    const s = r * 1.2;
    return `M${f(cx)} ${f(cy - s)}L${f(cx + s)} ${f(cy)}L${f(cx)} ${f(cy + s)}L${f(cx - s)} ${f(cy)}Z`;
  }
  if (shape === "triangle") {
    const s = r * 1.15;
    return `M${f(cx)} ${f(cy - s)}L${f(cx + s)} ${f(cy + s * 0.8)}L${f(cx - s)} ${f(cy + s * 0.8)}Z`;
  }
  // Rond : deux arcs.
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
}
