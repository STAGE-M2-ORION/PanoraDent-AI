import { InferenceMode } from "@/entities/analysis/@x/system-status";

/** État affiché tant que `/api/health` n'a pas répondu, ou s'il a échoué. */
export const OFFLINE_STATUS = {
  isOnline: false,
  backendStatus: "backend indisponible",
  inferenceReachable: false,
  inferenceMode: null,
};

/** DTO `/api/health` → modèle applicatif. */
export function normalizeSystemStatus(dto) {
  return {
    isOnline: dto.status === "ok",
    backendStatus: dto.status,
    inferenceReachable: Boolean(dto.inference_reachable),
    inferenceMode: dto.inference_mode ?? null,
  };
}

/** Mode mock : le bandeau doit avertir que les détections sont factices. */
export function isMockInference(status) {
  return status?.inferenceMode === InferenceMode.MOCK;
}
