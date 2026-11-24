import { normalizeDetection, toFractionBox } from "@/entities/detection/@x/analysis";
import { httpClient } from "@/shared/api";

import { normalizeAnalysis, normalizeAnalysisSummary, normalizeProcessing, withNumbers } from "../model/analysis";
import { normalizeComparison } from "../model/comparison";
import { normalizeHistoryPage, normalizeTimeline } from "../model/history";

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
    // « modele_texte » (détecteur OpenCV) ou « heuristique » (secours).
    detectionMethod: data.methode ?? "heuristique",
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

/** `GET /api/v1/historique` — une page filtrée, paginée par clé (sprint 8). */
export async function fetchHistory(params) {
  const { data } = await httpClient.get("/historique", { params });
  return normalizeHistoryPage(data);
}

/** `GET /api/v1/historique.csv` — export des analyses filtrées (journalisé). */
export async function fetchHistoryCsv(params) {
  const { data, headers } = await httpClient.get("/historique.csv", { params, responseType: "blob" });
  const m = /filename="?([^";]+)"?/i.exec(headers?.["content-disposition"] ?? "");
  return { blob: data, fileName: m ? m[1] : "historique-analyses.csv" };
}

/** `GET /api/v1/analyses/{id}/historique` — fiche d'historique, lue dans le journal. */
export async function fetchAnalysisTimeline(analysisId) {
  const { data } = await httpClient.get(`/analyses/${analysisId}/historique`);
  return normalizeTimeline(data);
}

/** `GET /api/v1/analyses/{id}` — analyse complète avec ses détections. */
export async function fetchAnalysis(analysisId) {
  const { data } = await httpClient.get(`/analyses/${analysisId}`);
  return normalizeAnalysis(data);
}

/** `GET /api/v1/analyses/{id}/statut` — suivi de la file (relu toutes les 2 s). */
export async function fetchAnalysisStatus(analysisId) {
  const { data } = await httpClient.get(`/analyses/${analysisId}/statut`);
  return normalizeProcessing(data);
}

/**
 * `POST /api/v1/analyses/{id}/lancer` — relance après un échec. Déjà en file
 * ou en cours : rien ne change (jamais deux tâches) ; terminée : 409.
 */
export async function launchAnalysis(analysisId) {
  const { data } = await httpClient.post(`/analyses/${analysisId}/lancer`);
  return normalizeProcessing(data);
}

/**
 * `POST /analyses/{id}/rejouer` (201) — nouvelle analyse du même cliché avec le
 * modèle actif, liée à l'originale, qui reste intacte (même clôturée).
 */
export async function replayAnalysis(analysisId) {
  const { data } = await httpClient.post(`/analyses/${analysisId}/rejouer`);
  return normalizeAnalysis(data);
}

/** `GET /analyses/{id}/comparaison` — propositions des deux modèles, classe par classe. */
export async function fetchComparison(analysisId, threshold = 0.25) {
  const { data } = await httpClient.get(`/analyses/${analysisId}/comparaison`, { params: { seuil: threshold } });
  return normalizeComparison(data);
}

/* ---------- Relecture (sprint 5) ----------
 * Les cadres circulent en pixels de l'image dans l'interface et partent au
 * serveur en fractions bornées à [0, 1] ; chaque réponse est la détection
 * normalisée (valeurs retenues, proposition d'origine, historique).
 */
const dimsOf = (analysis) => ({ imageWidth: analysis.width, imageHeight: analysis.height });

/**
 * `POST /analyses/{id}/detections/{det}/verdict` — `verdict` : valider,
 * corriger ou rejeter ; correction : `label`, `fdi`, `box` (pixels).
 */
export async function postVerdict(analysis, detectionId, verdict, { comment, label, fdi, box } = {}) {
  const body = { action: verdict };
  if (comment != null) body.commentaire = comment;
  if (label != null) body.label = label;
  if (fdi !== undefined) body.fdi = fdi;
  if (box) body.cadre = toFractionBox(box, analysis.width, analysis.height);
  const { data } = await httpClient.post(`/analyses/${analysis.id}/detections/${detectionId}/verdict`, body);
  return normalizeDetection(data, dimsOf(analysis));
}

/**
 * `POST /analyses/{id}/detections/{det}/annuler` — annule le dernier verdict.
 * Renvoie la détection, ou `null` si c'était un ajout du praticien (retiré).
 */
export async function undoVerdict(analysis, detectionId) {
  const { data } = await httpClient.post(`/analyses/${analysis.id}/detections/${detectionId}/annuler`);
  return data.detection ? normalizeDetection(data.detection, dimsOf(analysis)) : null;
}

/** `POST /analyses/{id}/detections` (201) — détection tracée par le praticien, née validée. */
export async function addDetection(analysis, { label, fdi, box, comment }) {
  const { data } = await httpClient.post(`/analyses/${analysis.id}/detections`, {
    label,
    fdi: fdi ?? null,
    cadre: toFractionBox(box, analysis.width, analysis.height),
    commentaire: comment?.trim() || null,
  });
  return normalizeDetection(data, dimsOf(analysis));
}

/**
 * `POST /analyses/{id}/dents/{fdi}/absente` — le praticien déclare une dent
 * absente ; `409 dent_detectee` si une dent porte ce numéro. Renvoie
 * l'analyse entière : les incohérences ont pu changer.
 */
export async function declareToothAbsent(analysisId, fdi) {
  const { data } = await httpClient.post(`/analyses/${analysisId}/dents/${fdi}/absente`);
  return normalizeAnalysis(data);
}

/** `DELETE /analyses/{id}/dents/{fdi}/absente` — retire la déclaration. */
export async function withdrawToothAbsent(analysisId, fdi) {
  const { data } = await httpClient.delete(`/analyses/${analysisId}/dents/${fdi}/absente`);
  return normalizeAnalysis(data);
}

/** `PUT /analyses/{id}/conclusion` — brouillon de la conclusion. */
export async function saveConclusion(analysisId, conclusion) {
  const { data } = await httpClient.put(`/analyses/${analysisId}/conclusion`, { conclusion });
  return normalizeAnalysis(data);
}

/** `POST /analyses/{id}/cloturer` — 409 `detections_a_revoir` (avec le compte) tant qu'il en reste. */
export async function closeAnalysis(analysisId, conclusion) {
  const { data } = await httpClient.post(`/analyses/${analysisId}/cloturer`, { conclusion });
  return normalizeAnalysis(data);
}

/** `POST /analyses/{id}/rouvrir` — administrateur ; motif obligatoire, journalisé. */
export async function reopenAnalysis(analysisId, motif) {
  const { data } = await httpClient.post(`/analyses/${analysisId}/rouvrir`, { motif });
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
