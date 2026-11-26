/**
 * Journal d'audit (administration) : filtres de l'écran → requête, réponse →
 * modèle. Le serveur lit le journal et les verdicts, et regroupe les actions
 * par session (`GET /journal`).
 */
export const EMPTY_AUDIT_FILTERS = { period: "7", author: "", category: "", result: "", action: "", target: "" };

/**
 * Filtres de l'écran → paramètres de `GET /journal` (et de l'export CSV).
 * `cursor` : curseur (date, identifiant) de la dernière entrée déjà affichée,
 * pour charger les entrées plus anciennes (pagination par clé).
 */
export function auditParams({ period, author, category, result, action, target }, cursor = null) {
  const p = { jours: Number(period) || 7 };
  if (author) p.auteur = author;
  if (category) p.categorie = category;
  if (result) p.resultat = result === "ok" ? "succes" : "echec";
  if (action) p.action = action;
  if (target && target.trim()) p.cible = target.trim();
  if (cursor) p.avant = cursor;
  return p;
}

const STATES = { active: "active", closed: "closed", expired: "expired", none: "none" };

export function normalizeAudit(dto) {
  return {
    days: dto.jours,
    total: dto.total ?? 0,
    truncated: Boolean(dto.tronque),
    next: dto.suivant ?? null,
    categories: dto.categories ?? [],
    actions: (dto.actions ?? []).map((a) => ({ code: a.code, label: a.libelle, category: a.categorie })),
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
        id: e.id,
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

const ORDER = { connexion: 0, deconnexion: 2 };
const chrono = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (ORDER[a.action] ?? 1) - (ORDER[b.action] ?? 1));

/**
 * Page suivante (entrées plus anciennes) ajoutée à ce qui est affiché : une
 * session à cheval sur deux pages reste UN groupe, ses entrées réunies dans
 * l'ordre chronologique.
 */
export function mergeAudit(current, older) {
  const byId = new Map(current.groups.map((g) => [g.id, { ...g, entries: [...g.entries] }]));
  for (const g of older.groups) {
    const known = byId.get(g.id);
    if (known) {
      const seen = new Set(known.entries.map((e) => e.id));
      known.entries = [...g.entries.filter((e) => !seen.has(e.id)), ...known.entries].sort(chrono);
    } else {
      byId.set(g.id, { ...g, entries: [...g.entries] });
    }
  }
  const groups = [...byId.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  const authors = [...new Map([...current.authors, ...older.authors].map((a) => [a.id, a])).values()];
  return { ...current, total: current.total + older.total, truncated: older.truncated, next: older.next, groups, authors };
}

/** `GET /journal/entrees/{id}` → détail d'une entrée, avec son contexte. */
export function normalizeAuditEntry(dto) {
  return {
    id: dto.id,
    source: dto.source,
    at: dto.date,
    action: dto.action,
    label: dto.libelle,
    category: dto.categorie,
    ok: Boolean(dto.ok),
    author: dto.auteur ? { name: dto.auteur.nom || "—", email: dto.auteur.email } : null,
    target: dto.cible ?? null,
    rawTarget: dto.cible_brute ?? null,
    detail: dto.precision ?? null,
    ip: dto.ip ?? null,
    session: dto.session
      ? { id: dto.session.id, device: dto.session.poste, ip: dto.session.ip, openedAt: dto.session.ouverte_le, closedAt: dto.session.fermee_le }
      : null,
    // Contexte brut, tel que le journal l'a gardé : clé → valeur lisible.
    context: Object.entries(dto.details ?? {})
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => [k.replace(/_/g, " "), typeof v === "object" ? JSON.stringify(v) : String(v)]),
  };
}

/** `GET /journal/retention` → durée, date limite, entrées purgeables, purge bloquée. */
export function normalizeRetention(dto) {
  return {
    days: dto.retention_jours,
    limitDate: dto.date_limite,
    purgeable: dto.lignes ?? 0,
    oldest: dto.plus_ancienne ?? null,
    loweredAt: dto.abaissee_le ?? null,
    blocked: Boolean(dto.purge_bloquee),
  };
}
