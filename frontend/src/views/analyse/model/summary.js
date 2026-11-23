/**
 * Résumé des anomalies par type et par quadrant, et filtres de la liste
 * (sprint 7) : logique pure, testée par vitest.
 */
import { ANOMALY_LABELS, URGENCY, anomalyTypology } from "@/entities/detection";
import { aboveThreshold } from "@/widgets/analysis-workspace";

/**
 * Quadrants FDI, nommés du côté du PATIENT (sa droite apparaît à gauche de
 * l'image) : le praticien lit « haut droit » comme il le dicterait.
 */
export const QUADRANTS = [
  { q: 1, short: "Q1", label: "maxillaire droit" },
  { q: 2, short: "Q2", label: "maxillaire gauche" },
  { q: 3, short: "Q3", label: "mandibule gauche" },
  { q: 4, short: "Q4", label: "mandibule droite" },
];

/** Quadrant d'un numéro FDI permanent (1 à 4), ou null. */
export function quadrantOf(fdi) {
  const q = Math.floor((fdi ?? 0) / 10);
  return q >= 1 && q <= 4 ? q : null;
}

/** Retenue : non rejetée et au-dessus du seuil affiché (curseur, ou seuils du modèle). */
const retained = (d, seuil) => d.status !== "rejected" && aboveThreshold(d, seuil);

/** Types dans l'ordre d'urgence (prioritaires d'abord), puis dans l'ordre de la maquette. */
export const TYPES_BY_URGENCY = [...ANOMALY_LABELS].sort((a, b) => URGENCY[anomalyTypology(a).urgency].rank - URGENCY[anomalyTypology(b).urgency].rank);

/**
 * Tableau type × quadrant des anomalies retenues. `unnumbered` compte celles
 * sans numéro de dent valide (rattachement impossible).
 */
export function anomalySummary(dets, { threshold = null, thresholds = null } = {}) {
  const kept = dets.filter((d) => ANOMALY_LABELS.includes(d.label) && retained(d, { threshold, thresholds }));
  const empty = () => ({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const byQuadrant = empty();
  const rows = TYPES_BY_URGENCY.map((label) => ({ label, counts: empty(), unnumbered: 0, total: 0 }));
  for (const d of kept) {
    const row = rows.find((r) => r.label === d.label);
    const q = quadrantOf(d.fdi);
    row.total += 1;
    if (q) {
      row.counts[q] += 1;
      byQuadrant[q] += 1;
    } else row.unnumbered += 1;
  }
  return {
    rows,
    byQuadrant,
    total: kept.length,
    unnumbered: rows.reduce((n, r) => n + r.unnumbered, 0),
    pending: kept.filter((d) => d.status === "pending").length,
  };
}

/** Filtres de la liste : dent, quadrant, type (chacun facultatif, cumulés). */
export function matchesFilters(d, { tooth = null, quadrant = null, type = null } = {}) {
  return (!tooth || d.fdi === tooth) && (!quadrant || quadrantOf(d.fdi) === quadrant) && (!type || d.label === type);
}

/** Libellé des filtres actifs, pour le message de liste vide. */
export function filtersText({ tooth = null, quadrant = null, type = null } = {}, typeText = (l) => l) {
  const parts = [];
  if (type) parts.push(typeText(type).toLowerCase());
  if (tooth) parts.push(`dent ${tooth}`);
  else if (quadrant) parts.push(`quadrant ${quadrant} (${QUADRANTS[quadrant - 1].label})`);
  return parts.join(", ");
}
