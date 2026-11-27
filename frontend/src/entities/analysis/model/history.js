import { normalizeAnalysisSummary } from "./analysis";

/**
 * Historique des analyses (sprint 8) : filtres de l'écran → requête du
 * serveur, et réponses → modèles. Filtrage, tri et pagination se font sur le
 * serveur (pagination par clé : `cursor` désigne la dernière ligne vue).
 */
export const EMPTY_HISTORY_FILTERS = {
  q: "", owner: "all", period: "all", status: "all", types: [], from: "", to: "", tooth: "", report: "", reader: "", sort: "recent",
};

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
  add("dent", filters.tooth ? String(filters.tooth) : "");
  add("compte_rendu", filters.report);
  add("lecteur", filters.reader);
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
      readers: e.lecteurs ?? [],
    })),
    total: dto.total ?? 0,
    next: dto.suivant ?? null,
    depositors: (dto.deposants ?? []).map((d) => ({ id: d.id, name: d.nom || "—" })),
    // Lecteurs à qui des analyses sont confiées (filtre « Confiée à ») ; vide pour un lecteur.
    readers: (dto.lecteurs ?? []).map((d) => ({ id: d.id, name: d.nom || "—" })),
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

// --- Sprint 12 : tri multi-colonnes, adresse de la page, vues enregistrées ---------------

/** Colonnes de tri du serveur (`tri=-statut,date`). */
export const SORT_FIELDS = {
  date: "Date d’import",
  reference: "Référence",
  statut: "État",
  examen: "Date d’examen",
};

/** « recent » / « -statut,date » → [{ field, desc }]. */
export function parseSort(sort) {
  const s = { recent: "-date", ancien: "date" }[sort] ?? (sort || "-date");
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => ({ field: x.replace(/^-/, ""), desc: x.startsWith("-") }))
    .filter((k) => SORT_FIELDS[k.field]);
}

/** [{ field, desc }] → « -statut,date » ; « recent » pour le tri par défaut. */
export function formatSort(keys) {
  const s = keys.map((k) => `${k.desc ? "-" : ""}${k.field}`).join(",");
  return s === "-date" || !s ? "recent" : s === "date" ? "ancien" : s;
}

const FDI = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48];
/** Numéros FDI des dents permanentes, par quadrant. */
export const FDI_QUADRANTS = [1, 2, 3, 4].map((q) => ({ quadrant: q, teeth: FDI.filter((n) => Math.floor(n / 10) === q) }));

const PERIODS = ["today", "7", "30", "custom"];
const STATUSES = ["queued", "running", "pending", "inprogress", "closed", "failed"];

/**
 * Filtres → paramètres de l'ADRESSE de la page (partageable). « Mes analyses »
 * devient l'identifiant de son auteur : le confrère qui ouvre le lien voit la
 * même sélection, s'il en a le droit — le serveur revérifie tout.
 */
export function filtersToQuery(f, meId = null) {
  const q = {};
  if (f.q.trim()) q.q = f.q.trim();
  if (f.owner !== "all") q.deposant = f.owner === "mine" ? meId ?? "moi" : f.owner;
  if (f.period !== "all") q.periode = f.period;
  if (f.period === "custom") {
    if (f.from) q.du = f.from;
    if (f.to) q.au = f.to;
  }
  if (f.status !== "all") q.etat = f.status;
  if (f.types.length) q.types = [...f.types];
  if (f.tooth) q.dent = String(f.tooth);
  if (f.report) q.cr = f.report;
  if (f.reader) q.lecteur = f.reader;
  if (f.sort !== "recent") q.tri = f.sort;
  return q;
}

const one = (v) => (Array.isArray(v) ? v[0] : v);

/** Paramètres de l'adresse → filtres (valeurs inconnues ignorées). */
export function queryToFilters(query, meId = null, labels = []) {
  const f = { ...EMPTY_HISTORY_FILTERS, types: [] };
  if (one(query.q)) f.q = String(one(query.q));
  const owner = one(query.deposant);
  if (owner) f.owner = owner === "moi" || owner === meId ? "mine" : String(owner);
  if (PERIODS.includes(one(query.periode))) f.period = one(query.periode);
  if (f.period === "custom") {
    f.from = one(query.du) ?? "";
    f.to = one(query.au) ?? "";
  }
  if (STATUSES.includes(one(query.etat))) f.status = one(query.etat);
  const types = query.types === undefined ? [] : [].concat(query.types);
  f.types = types.filter((t) => !labels.length || labels.includes(t));
  if (FDI.includes(Number(one(query.dent)))) f.tooth = String(Number(one(query.dent)));
  if (["telecharge", "non_telecharge"].includes(one(query.cr))) f.report = one(query.cr);
  if (one(query.lecteur)) f.reader = String(one(query.lecteur));
  if (one(query.tri) && parseSort(one(query.tri)).length) f.sort = formatSort(parseSort(one(query.tri)));
  return f;
}

/** Filtres de l'écran → filtres d'une vue enregistrée (format du serveur ; période relative gardée). */
export function filtersToView(f) {
  const v = {};
  if (f.q.trim()) v.q = f.q.trim();
  if (f.owner !== "all") v.deposant = f.owner === "mine" ? "moi" : f.owner;
  if (["today", "7", "30"].includes(f.period)) v.periode = f.period;
  if (f.period === "custom") {
    if (f.from) v.du = f.from;
    if (f.to) v.au = f.to;
  }
  if (f.status !== "all") v.etat = f.status;
  if (f.types.length) v.types = [...f.types];
  if (f.tooth) v.dent = Number(f.tooth);
  if (f.report) v.compte_rendu = f.report;
  if (f.reader) v.lecteur = f.reader;
  if (f.sort !== "recent") v.tri = f.sort;
  return v;
}

/** Filtres d'une vue enregistrée → filtres de l'écran. */
export function viewToFilters(v) {
  const f = { ...EMPTY_HISTORY_FILTERS, types: [] };
  if (v.q) f.q = v.q;
  if (v.deposant) f.owner = v.deposant === "moi" ? "mine" : v.deposant;
  if (v.periode) f.period = v.periode;
  else if (v.du || v.au) {
    f.period = "custom";
    f.from = v.du ?? "";
    f.to = v.au ?? "";
  }
  if (v.etat) f.status = v.etat;
  if (v.types) f.types = [...v.types];
  if (v.dent) f.tooth = String(v.dent);
  if (v.compte_rendu) f.report = v.compte_rendu;
  if (v.lecteur) f.reader = v.lecteur;
  if (v.tri) f.sort = v.tri;
  return f;
}

export function normalizeView(dto) {
  return { id: dto.id, name: dto.nom, filters: viewToFilters(dto.filtres ?? {}), createdAt: dto.cree_le };
}
