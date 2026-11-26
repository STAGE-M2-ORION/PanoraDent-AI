import { httpClient } from "@/shared/api";

import { normalizeStorage, normalizeSupervision } from "../model/system-status";

/** `GET /api/v1/supervision` — sondes détaillées et indicateurs (`user:manage`). */
export async function fetchSupervision() {
  const { data } = await httpClient.get("/supervision");
  return normalizeSupervision(data);
}

/** `GET /api/v1/stockage` — volume occupé dans le stockage objet (`user:manage`). */
export async function fetchStorage() {
  const { data } = await httpClient.get("/stockage");
  return normalizeStorage(data);
}
