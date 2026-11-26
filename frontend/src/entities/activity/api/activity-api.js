import { httpClient } from "@/shared/api";

import { normalizeActivity } from "../model/activity";

/** `GET /api/v1/tableau-de-bord/activite` — `analysis:read`. Portée choisie par le serveur. */
export async function fetchActivity() {
  const { data } = await httpClient.get("/tableau-de-bord/activite");
  return normalizeActivity(data);
}
