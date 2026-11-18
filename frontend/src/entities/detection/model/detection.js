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

/**
 * Présentation de chaque classe (palette Okabe-Ito, lisible par les
 * daltoniens). La couleur n'est jamais seule : nom et abréviation l'accompagnent.
 * `cls` est la classe CSS de la pastille (`.det-*`, cf. `detection.css`).
 */
export const DETECTION_TYPES = {
  [DetectionLabel.TOOTH]: { label: "Dent (numéro FDI)", short: "Dent", abbr: "FDI", cls: "det-tooth", color: "#56B4E9" },
  [DetectionLabel.CARIES]: { label: "Carie", short: "Carie", abbr: "C", cls: "det-caries", color: "#F0E442" },
  [DetectionLabel.DEEP_CARIES]: { label: "Carie profonde", short: "Carie profonde", abbr: "CP", cls: "det-deep", color: "#D55E00" },
  [DetectionLabel.PERIAPICAL_LESION]: { label: "Lésion péri-apicale", short: "Lésion péri-apicale", abbr: "LPA", cls: "det-periapical", color: "#CC79A7" },
  [DetectionLabel.IMPACTED_TOOTH]: { label: "Dent incluse", short: "Dent incluse", abbr: "DI", cls: "det-impacted", color: "#009E73" },
};

/** Les quatre anomalies, dans l'ordre d'affichage de la maquette. */
export const ANOMALY_LABELS = [
  DetectionLabel.CARIES,
  DetectionLabel.DEEP_CARIES,
  DetectionLabel.PERIAPICAL_LESION,
  DetectionLabel.IMPACTED_TOOTH,
];

/** Statut de relecture d'une détection. */
export const ReviewStatus = {
  PENDING: "pending",
  VALIDATED: "validated",
  CORRECTED: "corrected",
  ADDED: "added",
};

export const REVIEW_STATUS = {
  [ReviewStatus.PENDING]: { label: "Non revue", tone: undefined },
  [ReviewStatus.VALIDATED]: { label: "Validée", tone: "success" },
  [ReviewStatus.CORRECTED]: { label: "Corrigée", tone: "info" },
  [ReviewStatus.ADDED]: { label: "Ajoutée par le praticien", tone: "primary" },
};

/** Toute classe autre que `tooth` est une anomalie à signaler au praticien. */
export function isAnomaly(label) {
  return label !== DetectionLabel.TOOTH;
}

export function detectionType(label) {
  return DETECTION_TYPES[label] ?? { label, short: label, abbr: "?", cls: "", color: "#94A3B8" };
}

export function detectionLabelText(label) {
  return detectionType(label).label;
}

/** DTO backend (snake_case, `w`/`h`, confiance 0-1) → modèle applicatif. */
export function normalizeDetection(dto) {
  const fromUser = dto.source === "human" || dto.source === "user";
  return {
    id: dto.id,
    label: dto.label,
    fdi: dto.fdi ?? null,
    // Confiance en pourcentage entier ; null pour un ajout du praticien.
    confidence: fromUser ? null : Math.round((dto.confidence ?? 0) * 100),
    x: dto.x,
    y: dto.y,
    width: dto.w,
    height: dto.h,
    source: fromUser ? "user" : "ai",
    status: fromUser ? ReviewStatus.ADDED : dto.reviewed ? ReviewStatus.VALIDATED : ReviewStatus.PENDING,
  };
}
