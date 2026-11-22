import { normalizeDetection } from "@/entities/detection/@x/analysis";

export const InferenceMode = {
  MOCK: "mock",
  REAL: "real",
};

/**
 * Statut de relecture d'une analyse. Le backend ne le stocke pas encore : il
 * est déduit (rapport généré → clôturée, détections toutes relues → en cours…).
 */
export const AnalysisStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  PENDING: "pending",
  IN_PROGRESS: "inprogress",
  CLOSED: "closed",
  FAILED: "failed",
};

export const ANALYSIS_STATUS = {
  [AnalysisStatus.QUEUED]: { label: "En file d’attente", tone: "info" },
  [AnalysisStatus.RUNNING]: { label: "Analyse en cours", tone: "info" },
  [AnalysisStatus.PENDING]: { label: "À relire", tone: "warning" },
  [AnalysisStatus.IN_PROGRESS]: { label: "Relecture en cours", tone: "info" },
  [AnalysisStatus.CLOSED]: { label: "Clôturée", tone: "success" },
  [AnalysisStatus.FAILED]: { label: "Échec de l'analyse", tone: "danger" },
};

/** Statut de la file de traitement (serveur). */
export const Processing = {
  QUEUED: "en_file",
  RUNNING: "en_cours",
  DONE: "terminee",
  FAILED: "echouee",
};

/**
 * Statut affiché : celui de la file tant que l'analyse n'est pas terminée,
 * puis celui de la relecture (à relire, en cours dès un premier verdict, clôturée).
 */
export function displayStatus(processing, closed, reviewed = 0) {
  if (processing === Processing.QUEUED) return AnalysisStatus.QUEUED;
  if (processing === Processing.RUNNING) return AnalysisStatus.RUNNING;
  if (processing === Processing.FAILED) return AnalysisStatus.FAILED;
  if (closed) return AnalysisStatus.CLOSED;
  return reviewed > 0 ? AnalysisStatus.IN_PROGRESS : AnalysisStatus.PENDING;
}

/** Statut de la file → modèle (`GET /analyses/{id}/statut`). */
export function normalizeProcessing(dto) {
  return {
    id: dto.id,
    processing: dto.statut,
    error: dto.erreur ?? "",
    attempts: dto.tentatives ?? 0,
    durationMs: dto.duree_ms ?? null,
    position: dto.position ?? null,
  };
}

/**
 * Identifiant anonyme court affiché à l'écran (« 7F3A ») : les 4 premiers
 * caractères de l'identifiant technique. Aucune donnée patient n'est stockée.
 */
export function anonymousId(id) {
  return String(id ?? "").replace(/-/g, "").slice(0, 4).toUpperCase();
}

/** N° d'analyse sur 4 chiffres (« 0042 »). */
export function formatNumber(n) {
  return n == null ? "—" : String(n).padStart(4, "0");
}

/** DTO `AnalysisOut` → modèle applicatif. */
export function normalizeAnalysis(dto) {
  const dims = { imageWidth: dto.width, imageHeight: dto.height };
  const detections = (dto.detections ?? []).map((d) => normalizeDetection(d, dims));
  return {
    id: dto.id,
    // Référence anonyme attribuée à l'import (« PDX-2026-0042 »).
    ref: dto.reference ?? anonymousId(dto.id),
    createdAt: dto.created_at,
    examDate: dto.date_examen ?? null,
    note: dto.note ?? "",
    depositorId: dto.deposant_id ?? null,
    depositorName: dto.deposant_nom ?? null,
    maskedZones: dto.zones_masquees ?? { auto: 0, manuelles: 0 },
    imageKey: dto.image_key,
    reportKey: dto.report_key ?? null,
    modelVersion: dto.model_version,
    inferenceMode: dto.inference_mode,
    // Registre : version épinglée à la mise en file ; analyse d'origine d'un rejeu.
    requestedVersion: dto.version_demandee ?? null,
    originId: dto.origine_id ?? null,
    width: dto.width,
    height: dto.height,
    detections,
    processing: dto.statut ?? Processing.DONE,
    error: dto.erreur ?? "",
    attempts: dto.tentatives ?? 0,
    durationMs: dto.duree_ms ?? null,
    // Relecture.
    conclusion: dto.conclusion ?? "",
    closed: Boolean(dto.cloturee),
    closedAt: dto.cloturee_le ?? null,
    closedBy: dto.cloturee_par_nom ?? null,
    progress: { reviewed: dto.avancement?.revues ?? 0, total: dto.avancement?.total ?? 0 },
    // Numérotation (sprint 7) : signalements du serveur, dents déclarées absentes.
    incoherences: (dto.incoherences ?? []).map((i) => ({ type: i.type, fdi: i.fdi ?? [], message: i.message })),
    absentTeeth: (dto.dents_absentes ?? []).map((x) => ({ fdi: x.fdi, author: x.auteur_nom ?? null, at: x.cree_le })),
    // Seuils d'exploitation par classe, en fractions comme le serveur (null : version sans seuils).
    thresholds: dto.seuils ?? null,
    status: displayStatus(dto.statut ?? Processing.DONE, Boolean(dto.cloturee), dto.avancement?.revues ?? 0),
  };
}

/** DTO `AnalysisSummary` → modèle applicatif (sans les boîtes). */
export function normalizeAnalysisSummary(dto) {
  return {
    id: dto.id,
    ref: dto.reference ?? anonymousId(dto.id),
    createdAt: dto.created_at,
    examDate: dto.date_examen ?? null,
    depositorId: dto.deposant_id ?? null,
    depositorName: dto.deposant_nom ?? null,
    modelVersion: dto.model_version,
    inferenceMode: dto.inference_mode,
    detectionCount: dto.n_detections,
    labels: dto.labels ?? [],
    hasReport: Boolean(dto.has_report),
    closed: Boolean(dto.cloturee),
    toReview: dto.a_revoir ?? 0,
    reviewed: dto.revues ?? 0,
    processing: dto.statut ?? Processing.DONE,
    status: displayStatus(dto.statut ?? Processing.DONE, Boolean(dto.cloturee), dto.revues ?? 0),
  };
}

/**
 * Numérote une liste (plus récente d'abord) dans l'ordre chronologique :
 * la plus ancienne est la n° 0001.
 */
export function withNumbers(list) {
  const total = list.length;
  return list.map((item, index) => ({ ...item, number: total - index }));
}

/** En mode mock, les détections sont factices : aucune valeur diagnostique. */
export function isMockAnalysis(analysis) {
  return analysis?.inferenceMode === InferenceMode.MOCK;
}
