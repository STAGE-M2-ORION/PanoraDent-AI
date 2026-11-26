import { InferenceMode } from "@/entities/analysis/@x/system-status";

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

/** Mode mock : le bandeau doit avertir que les détections sont factices. */
export function isMockInference(status) {
  return status?.inferenceMode === InferenceMode.MOCK;
}
