/**
 * Notifications (sprint 13). Le serveur n'envoie que la référence anonyme de
 * l'analyse : jamais d'image, de note ni de conclusion.
 */
export const NotificationType = Object.freeze({
  ANALYSIS_DONE: "analyse_terminee",
  ANALYSIS_FAILED: "analyse_echouee",
  ANALYSIS_REOPENED: "analyse_rouverte",
  ACCESS_REQUEST: "demande_acces",
});

const TONES = {
  [NotificationType.ANALYSIS_DONE]: { icon: "check", tone: "success" },
  [NotificationType.ANALYSIS_FAILED]: { icon: "alert", tone: "danger" },
  [NotificationType.ANALYSIS_REOPENED]: { icon: "refresh", tone: "warning" },
  [NotificationType.ACCESS_REQUEST]: { icon: "users", tone: "info" },
};

export function normalizeNotification(dto) {
  return {
    id: dto.id,
    type: dto.type,
    title: dto.titre,
    message: dto.message ?? "",
    analysisId: dto.analyse_id ?? null,
    reference: dto.reference ?? null,
    createdAt: dto.cree_le,
    read: Boolean(dto.lue),
    // Page de l'application donnée par le serveur (demande d'accès), sinon l'analyse.
    href: dto.lien && dto.lien.startsWith("/") ? dto.lien : dto.analyse_id ? `/analyse?id=${encodeURIComponent(dto.analyse_id)}` : null,
    ...(TONES[dto.type] ?? { icon: "bell", tone: "info" }),
  };
}

export function normalizePage(dto) {
  return {
    unread: dto.non_lues ?? 0,
    items: (dto.notifications ?? []).map(normalizeNotification),
    next: dto.suivant ?? null,
  };
}

/** Message du flux → { unread, notification? } ; null si inconnu. */
export function parseStreamMessage(texte) {
  let m;
  try {
    m = JSON.parse(texte);
  } catch {
    return null;
  }
  if (m?.type === "etat") return { unread: m.non_lues ?? 0 };
  if (m?.type === "notification" && m.notification) return { unread: m.non_lues ?? 0, notification: normalizeNotification(m.notification) };
  return null;
}

/** Adresse du flux, sur la même origine que l'API (`ws:` ou `wss:`). */
export function streamUrl(apiBase, location) {
  const base = new URL(`${apiBase.replace(/\/$/, "")}/moi/notifications/flux`, location.href);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  return base.toString();
}

/** Attente avant la reconnexion n° `tentative` (1, 2, 4 … 30 s). */
export function reconnectDelay(tentative) {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, tentative));
}

/** Fermetures définitives : pas de reconnexion aveugle. */
export const CloseCode = Object.freeze({ UNAUTHENTICATED: 4401, TOO_MANY_TABS: 4429, FORBIDDEN_ORIGIN: 1008 });

/** Insère une notification arrivée en direct, sans doublon, la plus récente d'abord. */
export function mergeIncoming(items, notification) {
  return [notification, ...items.filter((n) => n.id !== notification.id)];
}

/** « à l'instant », « il y a 5 min », « il y a 3 h », sinon la date. */
export function relativeTime(iso, maintenant = new Date()) {
  const quand = new Date(iso);
  const s = Math.round((maintenant - quand) / 1000);
  if (s < 60) return "à l’instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.floor(s / 3600)} h`;
  return quand.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
