import { httpClient } from "@/shared/api";

/** DTO `/api/model/versions` → modèle applicatif. */
export function normalizeModelVersion(dto) {
  return {
    version: dto.version,
    dataset: dto.dataset ?? "",
    metrics: dto.metrics ?? {},
    notes: dto.notes ?? "",
    createdAt: dto.created_at,
  };
}

/** `GET /api/model/versions` (permission `model:read`) — la plus récente d'abord. */
export async function fetchModelVersions() {
  const { data } = await httpClient.get("/model/versions");
  return data.map(normalizeModelVersion);
}
