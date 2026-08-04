import { normalizeDetection } from "@/entities/detection/@x/analysis";

export const InferenceMode = {
  MOCK: "mock",
  REAL: "real",
};

/** DTO `AnalysisOut` → modèle applicatif. */
export function normalizeAnalysis(dto) {
  return {
    id: dto.id,
    createdAt: dto.created_at,
    imageKey: dto.image_key,
    reportKey: dto.report_key ?? null,
    modelVersion: dto.model_version,
    inferenceMode: dto.inference_mode,
    width: dto.width,
    height: dto.height,
    detections: (dto.detections ?? []).map(normalizeDetection),
  };
}

/** DTO `AnalysisSummary` → modèle applicatif (sans les boîtes). */
export function normalizeAnalysisSummary(dto) {
  return {
    id: dto.id,
    createdAt: dto.created_at,
    modelVersion: dto.model_version,
    inferenceMode: dto.inference_mode,
    detectionCount: dto.n_detections,
  };
}

/** En mode mock, les détections sont factices : aucune valeur diagnostique. */
export function isMockAnalysis(analysis) {
  return analysis?.inferenceMode === InferenceMode.MOCK;
}
