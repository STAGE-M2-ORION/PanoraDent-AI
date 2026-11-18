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
  PENDING: "pending",
  IN_PROGRESS: "inprogress",
  CLOSED: "closed",
  FAILED: "failed",
};

export const ANALYSIS_STATUS = {
  [AnalysisStatus.PENDING]: { label: "À relire", tone: "warning" },
  [AnalysisStatus.IN_PROGRESS]: { label: "Relecture en cours", tone: "info" },
  [AnalysisStatus.CLOSED]: { label: "Clôturée", tone: "success" },
  [AnalysisStatus.FAILED]: { label: "Échec de l'analyse", tone: "danger" },
};

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
  const detections = (dto.detections ?? []).map(normalizeDetection);
  return {
    id: dto.id,
    ref: anonymousId(dto.id),
    createdAt: dto.created_at,
    imageKey: dto.image_key,
    reportKey: dto.report_key ?? null,
    modelVersion: dto.model_version,
    inferenceMode: dto.inference_mode,
    width: dto.width,
    height: dto.height,
    detections,
    status: dto.report_key ? AnalysisStatus.CLOSED : AnalysisStatus.PENDING,
  };
}

/** DTO `AnalysisSummary` → modèle applicatif (sans les boîtes). */
export function normalizeAnalysisSummary(dto) {
  return {
    id: dto.id,
    ref: anonymousId(dto.id),
    createdAt: dto.created_at,
    modelVersion: dto.model_version,
    inferenceMode: dto.inference_mode,
    detectionCount: dto.n_detections,
    labels: dto.labels ?? [],
    hasReport: Boolean(dto.has_report),
    status: dto.has_report ? AnalysisStatus.CLOSED : AnalysisStatus.PENDING,
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
