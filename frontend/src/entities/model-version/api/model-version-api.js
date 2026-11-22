import { httpClient } from "@/shared/api";

/**
 * DTO `/model/versions` → modèle applicatif. Une version est une PAIRE de
 * modèles (dents + anomalies) ; une seule est active.
 */
export function normalizeModelVersion(dto) {
  return {
    id: dto.id ?? dto.version,
    version: dto.version,
    dataset: dto.dataset ?? "",
    metrics: dto.metrics ?? {},
    notes: dto.notes ?? "",
    createdAt: dto.created_at,
    active: Boolean(dto.actif),
    activatedAt: dto.active_le ?? null,
    servable: Boolean(dto.servable),
    splitHash: dto.empreinte_decoupage ?? null,
    sha256: { teeth: dto.sha256?.dents ?? null, anomalies: dto.sha256?.anomalies ?? null },
  };
}

export function normalizeModelSwitch(dto) {
  return {
    at: dto.horodatage,
    from: dto.version_precedente ?? null,
    to: dto.version,
    reason: dto.motif ?? "",
    author: dto.auteur_nom ?? null,
  };
}

/** `GET /model/versions` (`model:read`) — la plus récente d'abord. */
export async function fetchModelVersions() {
  const { data } = await httpClient.get("/model/versions");
  return data.map(normalizeModelVersion);
}

/**
 * `POST /model/versions/{version}/activer` (`model:manage`) — motif
 * obligatoire. Le service d'inférence charge et vérifie la version avant
 * qu'elle ne devienne active ; un refus garde l'ancienne.
 */
export async function activateModelVersion(version, motif) {
  const { data } = await httpClient.post(`/model/versions/${encodeURIComponent(version)}/activer`, { motif });
  return normalizeModelVersion(data);
}

/** `GET /model/bascules` (`model:read`) — journal des bascules, le plus récent d'abord. */
export async function fetchModelSwitches() {
  const { data } = await httpClient.get("/model/bascules");
  return data.map(normalizeModelSwitch);
}
