import { normalizeAnalysisSummary } from "./analysis";

/**
 * Historique des analyses (sprint 8) : filtres de l'écran → requête du
 * serveur, et réponses → modèles. Filtrage, tri et pagination se font sur le
 * serveur (pagination par clé : `cursor` désigne la dernière ligne vue).
 */
export const EMPTY_HISTORY_FILTERS = { q: "", owner: "all", period: "all", status: "all", types: [], from: "", to: "", sort: "recent" };

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Période de l'écran → bornes de dates (jours civils). `today` : injectable pour les tests. */
export function periodBounds({ period, from, to }, today = new Date()) {
  if (period === "today") return { du: iso(today), au: iso(today) };
  if (period === "7" || period === "30") {
    const start = new Date(today);
    start.setDate(start.getDate() - Number(period));
    return { du: iso(start), au: iso(today) };
  }
  if (period === "custom") return { du: from || "", au: to || "" };
  return { du: "", au: "" };
}

/**
 * Filtres → paramètres de `GET /historique` (et de l'export CSV). Les
 * paramètres vides sont omis ; `types` se répète (`types=a&types=b`).
 */
export function historyParams(filters, { cursor = "", limit = null } = {}, today = new Date()) {
  const p = new URLSearchParams();
  const add = (k, v) => v && p.append(k, v);
  add("q", filters.q.trim());
  add("deposant", filters.owner === "all" ? "" : filters.owner === "mine" ? "moi" : filters.owner);
  add("etat", filters.status === "all" ? "" : filters.status);
  const { du, au } = periodBounds(filters, today);
  add("du", du);
  add("au", au);
  filters.types.forEach((t) => p.append("types", t));
  add("tri", filters.sort === "recent" ? "" : filters.sort);
  if (limit) p.append("limite", String(limit));
  add("apres", cursor);
  return p;
}

/** Une page de l'historique. */
export function normalizeHistoryPage(dto) {
  return {
    items: (dto.elements ?? []).map((e) => ({
      ...normalizeAnalysisSummary(e),
      number: e.numero ?? null,
      retainedCount: e.anomalies_retenues ?? 0,
      closedAt: e.cloturee_le ?? null,
    })),
    total: dto.total ?? 0,
    next: dto.suivant ?? null,
    depositors: (dto.deposants ?? []).map((d) => ({ id: d.id, name: d.nom || "—" })),
  };
}

/** Fiche d'historique d'une analyse : événements dans l'ordre chronologique. */
export function normalizeTimeline(dto) {
  return {
    ref: dto.reference,
    events: (dto.evenements ?? []).map((e) => ({
      at: e.date,
      action: e.action,
      label: e.libelle,
      author: e.auteur ?? null,
      detail: e.precision ?? null,
      cancelledAt: e.annule_le ?? null,
      kind: e.action.startsWith("verdict_") ? "verdict" : e.action.startsWith("compte_rendu_") ? "report" : "event",
    })),
  };
}
