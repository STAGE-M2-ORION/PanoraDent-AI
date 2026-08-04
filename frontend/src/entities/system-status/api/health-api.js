import { httpClient } from "@/shared/api";

import { normalizeSystemStatus } from "../model/system-status";

/** `GET /api/health` — état du backend et joignabilité de l'inférence. */
export async function fetchSystemStatus() {
  const { data } = await httpClient.get("/health");
  return normalizeSystemStatus(data);
}
