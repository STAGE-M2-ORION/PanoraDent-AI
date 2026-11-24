/**
 * Journal d'audit (administration) : filtres de l'écran → requête, réponse →
 * modèle. Le serveur lit le journal et les verdicts, et regroupe les actions
 * par session (`GET /journal`).
 */
export const EMPTY_AUDIT_FILTERS = { period: "7", author: "", category: "", result: "" };

/** Filtres → paramètres de `GET /journal` (et de l'export CSV). */
export function auditParams({ period, author, category, result }) {
  const p = { jours: Number(period) || 7 };
  if (author) p.auteur = author;
  if (category) p.categorie = category;
  if (result) p.resultat = result === "ok" ? "succes" : "echec";
  return p;
}

const STATES = { active: "active", closed: "closed", expired: "expired", none: "none" };

export function normalizeAudit(dto) {
  return {
    days: dto.jours,
    total: dto.total ?? 0,
    truncated: Boolean(dto.tronque),
    categories: dto.categories ?? [],
    authors: (dto.auteurs ?? []).map((a) => ({ id: a.id, name: a.nom || "—" })),
    groups: (dto.sessions ?? []).map((g) => ({
      id: g.id,
      user: { id: g.utilisateur?.id ?? null, name: g.utilisateur?.nom || "—" },
      title: g.titre ?? null,
      device: g.poste ?? null,
      ip: g.ip ?? null,
      method: g.methode ?? null,
      state: STATES[g.etat] ?? "none",
      openedAt: g.ouverte_le ?? null,
      closedAt: g.fermee_le ?? null,
      lastAt: g.derniere,
      entries: (g.entrees ?? []).map((e) => ({
        at: e.date,
        action: e.action,
        label: e.libelle,
        category: e.categorie,
        ok: Boolean(e.ok),
        target: e.cible ?? null,
        detail: e.precision ?? null,
      })),
    })),
  };
}

/** Durée lisible entre deux dates ISO (« 12 min », « 1 h 05 »), ou null si nulle. */
export function spanLabel(from, to) {
  const ms = new Date(`${to}Z`.replace(/Z+$/, "Z")) - new Date(`${from}Z`.replace(/Z+$/, "Z"));
  const m = Math.round(ms / 60000);
  if (!Number.isFinite(m) || m <= 0) return null;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** Jour local (AAAA-MM-JJ) d'une date ISO du serveur (UTC sans fuseau). */
export function localDay(iso) {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(iso)) ? iso : `${iso}Z`);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
