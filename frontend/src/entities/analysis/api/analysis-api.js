import { httpClient } from "@/shared/api";

import { normalizeAnalysis, normalizeAnalysisSummary, withNumbers } from "../model/analysis";

/** `POST /api/analyses` — anonymise, stocke, infère et persiste. */
export async function createAnalysis(file, { onProgress } = {}) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await httpClient.post("/analyses", form, {
    onUploadProgress: onProgress ? (event) => event.total && onProgress(Math.round((event.loaded / event.total) * 100)) : undefined,
  });
  return normalizeAnalysis(data);
}

/** `GET /api/analyses` — résumés numérotés, plus récents d'abord. */
export async function fetchAnalyses() {
  const { data } = await httpClient.get("/analyses");
  return withNumbers(data.map(normalizeAnalysisSummary));
}

/** `GET /api/analyses/{id}` — analyse complète avec ses détections. */
export async function fetchAnalysis(analysisId) {
  const { data } = await httpClient.get(`/analyses/${analysisId}`);
  return normalizeAnalysis(data);
}

/** `GET /api/analyses/{id}/image` — URL présignée S3, valable 1 h. */
export async function fetchAnalysisImageUrl(analysisId) {
  const { data } = await httpClient.get(`/analyses/${analysisId}/image`);
  return data.url;
}

/**
 * `DELETE /api/analyses/{id}` — la permission `analysis:delete` existe côté
 * backend mais pas encore la route : l'appel peut répondre 404/405.
 */
export async function deleteAnalysis(analysisId) {
  await httpClient.delete(`/analyses/${analysisId}`);
}
