/**
 * Classes du périmètre, dans l'ordre déclaré côté service d'inférence
 * (`inference/app/config.py`). Toute évolution doit rester synchronisée.
 */
export const DetectionLabel = {
  TOOTH: "tooth",
  CARIES: "caries",
  DEEP_CARIES: "deep_caries",
  PERIAPICAL_LESION: "periapical_lesion",
  IMPACTED_TOOTH: "impacted_tooth",
};

const LABEL_TEXT = {
  [DetectionLabel.TOOTH]: "Dent",
  [DetectionLabel.CARIES]: "Carie",
  [DetectionLabel.DEEP_CARIES]: "Carie profonde",
  [DetectionLabel.PERIAPICAL_LESION]: "Lésion périapicale",
  [DetectionLabel.IMPACTED_TOOTH]: "Dent incluse",
};

/** Couleurs de tracé — dupliquées en dur dans le canvas, pas de variable CSS ici. */
export const DetectionColor = {
  NORMAL: "#0F766E",
  ANOMALY: "#C0392B",
};

/** Toute classe autre que `tooth` est une anomalie à signaler au praticien. */
export function isAnomaly(label) {
  return label !== DetectionLabel.TOOTH;
}

export function detectionLabelText(label) {
  return LABEL_TEXT[label] ?? label;
}

export function detectionColor(label) {
  return isAnomaly(label) ? DetectionColor.ANOMALY : DetectionColor.NORMAL;
}

/** DTO backend (snake_case, `w`/`h`) → modèle applicatif. */
export function normalizeDetection(dto) {
  return {
    id: dto.id,
    label: dto.label,
    fdi: dto.fdi ?? null,
    confidence: dto.confidence,
    x: dto.x,
    y: dto.y,
    width: dto.w,
    height: dto.h,
    reviewed: Boolean(dto.reviewed),
    source: dto.source,
  };
}
