import { Processing } from "./analysis";

/** Ordre d'affichage : anomalies d'abord, la numérotation des dents en dernier. */
const ORDER = ["caries", "deep_caries", "periapical_lesion", "impacted_tooth", "tooth"];

/**
 * DTO `/analyses/{id}/comparaison` → modèle applicatif. `rows` est `null`
 * tant que le rejeu n'est pas terminé. Chaque ligne : propositions de
 * l'ancien modèle, du nouveau, communes (même classe, IoU ≥ 0,50), et ce que
 * chacun voit seul.
 */
export function normalizeComparison(dto) {
  const parClasse = dto.par_classe;
  const rows = parClasse
    ? Object.entries(parClasse)
        .map(([label, c]) => ({
          label,
          before: c.origine,
          after: c.rejeu,
          common: c.communes,
          onlyBefore: c.seulement_origine,
          onlyAfter: c.seulement_rejeu,
        }))
        .sort((a, b) => rank(a.label) - rank(b.label))
    : null;
  return {
    threshold: dto.seuil,
    origin: { id: dto.origine.id, ref: dto.origine.reference, modelVersion: dto.origine.model_version },
    replay: { id: dto.rejeu.id, ref: dto.rejeu.reference, status: dto.rejeu.statut, modelVersion: dto.rejeu.model_version },
    rows,
    totals: rows ? totals(rows) : null,
  };
}

function rank(label) {
  const i = ORDER.indexOf(label);
  return i === -1 ? ORDER.length : i;
}

function totals(rows) {
  return rows.reduce(
    (t, r) => ({ before: t.before + r.before, after: t.after + r.after, common: t.common + r.common, onlyBefore: t.onlyBefore + r.onlyBefore, onlyAfter: t.onlyAfter + r.onlyAfter }),
    { before: 0, after: 0, common: 0, onlyBefore: 0, onlyAfter: 0 },
  );
}

/**
 * Rejouer est proposé si l'analyse est terminée, qu'un modèle est actif et que
 * ce n'est pas déjà celui qui l'a produite. Le serveur revérifie.
 */
export function canReplay(analysis, active) {
  return Boolean(analysis && active && analysis.processing === Processing.DONE && analysis.modelVersion !== active.version);
}
