/** État affiché tant que `/api/health` n'a pas répondu, ou s'il a échoué. */
export const OFFLINE_STATUS = {
  isOnline: false,
  backendStatus: "backend indisponible",
  inferenceReachable: false,
  inferenceMode: null,
  services: {},
};

/**
 * DTO `/api/health` → modèle applicatif. Depuis le sprint 11, la page de santé
 * ne donne qu'un état par service (`ok`, `degrade`, `panne`) : plus de mode du
 * modèle en public. Elle répond 503 quand la base est injoignable.
 */
export function normalizeSystemStatus(dto) {
  const services = dto.services ?? {};
  return {
    isOnline: dto.statut === "ok" || dto.statut === "degrade",
    backendStatus: dto.statut,
    inferenceReachable: Boolean(services.inference) && services.inference !== "panne",
    inferenceMode: null,
    services,
  };
}

/** Services sondés (sprint 11), dans l'ordre d'affichage. */
export const SERVICES = [
  { key: "base", name: "Base de données", icon: "database" },
  { key: "stockage", name: "Stockage des images", icon: "box" },
  { key: "file", name: "File de traitement", icon: "layers" },
  { key: "inference", name: "Service d’analyse (modèle)", icon: "cpu" },
];

export const SERVICE_STATES = {
  ok: { label: "Opérationnel", tone: "success", icon: "check" },
  degrade: { label: "Dégradé", tone: "warning", icon: "alert" },
  panne: { label: "En panne", tone: "danger", icon: "x" },
};

/** Ce que l'incident change pour l'utilisateur, en clair (bandeau de l'application). */
const CONSEQUENCES = {
  base: { panne: "Le serveur ne peut plus lire ni enregistrer les données : réessayez dans un instant." },
  stockage: { panne: "Le stockage des images ne répond pas : les radiographies ne s’affichent plus et aucun import n’est possible." },
  file: {
    degrade: "Les analyses prennent du retard : celles en attente seront traitées dès que possible.",
    panne: "La file de traitement est inaccessible : les nouvelles analyses ne partent pas.",
  },
  inference: {
    degrade: "Le service d’analyse fonctionne en mode dégradé : ses détections ne sont pas fiables.",
    panne: "Le service d’analyse est indisponible : les nouvelles analyses attendront dans la file.",
  },
};

/**
 * Alertes à montrer dans toute l'application : une par service dégradé ou en
 * panne, plus une si le serveur ne répond pas du tout. Liste vide si tout va
 * bien, ou tant que l'état n'est pas connu.
 */
export function serviceAlerts(status) {
  if (!status) return [];
  if (!status.isOnline) {
    return [{ key: "serveur", tone: "danger", text: "Le serveur ne répond pas : vos dernières actions n’ont peut-être pas été enregistrées. Nouvel essai automatique." }];
  }
  return SERVICES.flatMap(({ key }) => {
    const state = status.services?.[key];
    const text = CONSEQUENCES[key]?.[state];
    return text ? [{ key, tone: state === "panne" ? "danger" : "warning", text }] : [];
  });
}

/** `GET /supervision` → modèle (administration). */
export function normalizeSupervision(dto) {
  const ind = dto.indicateurs;
  return {
    status: dto.statut,
    services: SERVICES.map((s) => {
      const p = dto.services?.[s.key] ?? {};
      return { ...s, state: SERVICE_STATES[p.etat] ? p.etat : "panne", detail: p.detail ?? "", latencyMs: p.latence_ms ?? null };
    }),
    indicators: ind
      ? {
          days: (ind.analyses_par_jour ?? []).map((d) => ({ day: d.jour, count: d.analyses })),
          averageMs: ind.duree_moyenne_ms ?? null,
          failureRate: ind.taux_echec ?? null,
          processed: ind.traitees ?? 0,
          failed: ind.echouees ?? 0,
        }
      : null,
  };
}

/** `GET /stockage` → modèle : volume occupé et seuil d'alerte. */
export function normalizeStorage(dto) {
  return { objects: dto.objets, bytes: dto.octets, thresholdBytes: dto.seuil_octets, alert: Boolean(dto.alerte) };
}

/** « 512 ms », « 2,4 s » ; « — » si absente. */
export function formatDuration(ms) {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
}
