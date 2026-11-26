import { httpClient } from "@/shared/api";

import { normalizeCabinet, toCabinetPayload } from "../model/cabinet";

/** `GET /api/v1/cabinet` — toute session ouverte. */
export async function fetchCabinet() {
  const { data } = await httpClient.get("/cabinet");
  return normalizeCabinet(data);
}

/** `PUT /api/v1/cabinet` — permission `cabinet:manage`, journalisé. */
export async function saveCabinet(values) {
  const { data } = await httpClient.put("/cabinet", toCabinetPayload(values));
  return normalizeCabinet(data);
}

/** `PUT /api/v1/cabinet/logo` — PNG, JPEG ou WebP, 1 Mo ; ré-encodé en PNG par le serveur. */
export async function uploadCabinetLogo(file) {
  const body = new FormData();
  body.append("fichier", file);
  const { data } = await httpClient.put("/cabinet/logo", body);
  return normalizeCabinet(data);
}

/** `DELETE /api/v1/cabinet/logo` (204). */
export async function removeCabinetLogo() {
  await httpClient.delete("/cabinet/logo");
  return fetchCabinet();
}

/** `PUT /api/v1/cabinet/retention` — durée de conservation du journal, journalisée. */
export async function saveRetention(days) {
  const { data } = await httpClient.put("/cabinet/retention", { jours: days });
  return normalizeCabinet(data);
}
