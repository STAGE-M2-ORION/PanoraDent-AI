import { httpClient } from "@/shared/api";

/**
 * `POST /api/analyses/{id}/report` — génère le PDF annoté côté serveur, le
 * stocke, et renvoie une URL présignée valable 1 h. Un second appel régénère
 * et écrase le rapport existant.
 */
export async function requestReport(analysisId) {
  const { data } = await httpClient.post(`/analyses/${analysisId}/report`);
  return data.url;
}
