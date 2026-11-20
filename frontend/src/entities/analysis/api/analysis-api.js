import { httpClient } from "@/shared/api";

import { normalizeAnalysis, normalizeAnalysisSummary, withNumbers } from "../model/analysis";

const toZone = (z) => ({ x: z.x, y: z.y, w: z.w, h: z.h });

/**
 * `POST /api/v1/analyses/apercu` — contrôle et anonymisation SANS rien
 * stocker : `{ width, height, autoZones, manualZones, before, after }`, les
 * images en data URL (réduites), les zones en fractions de l'image. Refus du
 * serveur : 413 (plus de 20 Mo), 415 (format), 422 (illisible, trop petite).
 */
export async function previewAnalysis(file, { masks = [], onProgress } = {}) {
  const form = new FormData();
  form.append("fichier", file);
  if (masks.length) form.append("masques", JSON.stringify(masks.map(toZone)));
  const { data } = await httpClient.post("/analyses/apercu", form, {
    onUploadProgress: onProgress ? (e) => e.total && onProgress(Math.round((e.loaded / e.total) * 100)) : undefined,
  });
  return {
    width: data.largeur,
    height: data.hauteur,
    autoZones: data.zones_auto.map(toZone),
    manualZones: data.zones_manuelles.map(toZone),
    before: data.avant,
    after: data.apres,
  };
}

/**
 * `POST /api/v1/analyses` — confirmation de l'import : le fichier est renvoyé
 * avec les masques manuels, ré-anonymisé ; seule l'image masquée est stockée,
 * puis analysée. `examDate` (AAAA-MM-JJ) et `note` sont facultatifs.
 */
export async function createAnalysis(file, { masks = [], examDate, note, onProgress } = {}) {
  const form = new FormData();
  form.append("fichier", file);
  if (masks.length) form.append("masques", JSON.stringify(masks.map(toZone)));
  if (examDate) form.append("date_examen", examDate);
  if (note?.trim()) form.append("note", note.trim());
  const { data } = await httpClient.post("/analyses", form, {
    onUploadProgress: onProgress ? (e) => e.total && onProgress(Math.round((e.loaded / e.total) * 100)) : undefined,
  });
  return normalizeAnalysis(data);
}

/** `GET /api/v1/analyses` — résumés numérotés, plus récents d'abord ; `mine` : ses propres analyses. */
export async function fetchAnalyses({ mine = false } = {}) {
  const { data } = await httpClient.get("/analyses", { params: mine ? { mine: true } : undefined });
  return withNumbers(data.map(normalizeAnalysisSummary));
}

/** `GET /api/v1/analyses/{id}` — analyse complète avec ses détections. */
export async function fetchAnalysis(analysisId) {
  const { data } = await httpClient.get(`/analyses/${analysisId}`);
  return normalizeAnalysis(data);
}

/** `GET /api/v1/analyses/{id}/image` — URL présignée (1 h) de la version d'affichage. */
export async function fetchAnalysisImageUrl(analysisId) {
  const { data } = await httpClient.get(`/analyses/${analysisId}/image`);
  return data.url;
}

/**
 * `DELETE /api/v1/analyses/{id}` (204) — réservée au déposant et à
 * l'administrateur (403 sinon) ; efface l'image et le compte rendu.
 */
export async function deleteAnalysis(analysisId) {
  await httpClient.delete(`/analyses/${analysisId}`);
}
