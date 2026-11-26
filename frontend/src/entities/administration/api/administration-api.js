import { httpClient } from "@/shared/api";

import { normalizeIndicators } from "../model/indicators";

/** `GET /api/v1/administration/indicateurs` — `user:manage`. */
export async function fetchAdminIndicators() {
  const { data } = await httpClient.get("/administration/indicateurs");
  return normalizeIndicators(data);
}
