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

/** Statut de relecture d'une détection (« added » : tracée par le praticien, retenue). */
export const ReviewStatus = {
  PENDING: "pending",
  VALIDATED: "validated",
  CORRECTED: "corrected",
  REJECTED: "rejected",
  ADDED: "added",
};

export const REVIEW_STATUS = {
  [ReviewStatus.PENDING]: { label: "À revoir", tone: "warning" },
  [ReviewStatus.VALIDATED]: { label: "Validée", tone: "success" },
  [ReviewStatus.CORRECTED]: { label: "Corrigée", tone: "info" },
  [ReviewStatus.REJECTED]: { label: "Rejetée", tone: "danger" },
  [ReviewStatus.ADDED]: { label: "Ajoutée par le praticien", tone: "primary" },
};

/** État serveur → statut affiché. */
const STATUS_OF_STATE = {
  a_revoir: ReviewStatus.PENDING,
  validee: ReviewStatus.VALIDATED,
  corrigee: ReviewStatus.CORRECTED,
  rejetee: ReviewStatus.REJECTED,
};

/** Verdicts envoyés au serveur. */
export const Verdict = { VALIDATE: "valider", CORRECT: "corriger", REJECT: "rejeter" };

/** Statut d'une détection d'après son état serveur et son origine. */
export function reviewStatus(etat, fromUser) {
  const status = STATUS_OF_STATE[etat] ?? ReviewStatus.PENDING;
  return fromUser && status === ReviewStatus.VALIDATED ? ReviewStatus.ADDED : status;
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/**
 * Cadre en pixels de l'image → fractions (0 à 1) attendues par le serveur,
 * borné à l'image : un cadre qui déborde est ramené dedans, jamais refusé
 * pour quelques pixels.
 */
export function toFractionBox(box, imageWidth, imageHeight) {
  const x0 = Math.min(Math.max(box.x, 0), imageWidth);
  const y0 = Math.min(Math.max(box.y, 0), imageHeight);
  const x1 = Math.min(Math.max(box.x + box.w, 0), imageWidth);
  const y1 = Math.min(Math.max(box.y + box.h, 0), imageHeight);
  return { x: round6(x0 / imageWidth), y: round6(y0 / imageHeight), w: round6((x1 - x0) / imageWidth), h: round6((y1 - y0) / imageHeight) };
}

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

/**
 * DTO backend → modèle applicatif. Le serveur stocke les boîtes en FRACTIONS
 * de l'image (0 à 1) ; on les ramène ici aux pixels de l'image (`imageWidth`
 * × `imageHeight`), repère de la visionneuse : zoom et redimensionnement
 * n'ont alors aucun effet sur l'alignement.
 */
export function normalizeDetection(dto, { imageWidth = 1, imageHeight = 1 } = {}) {
  const fromUser = dto.source === "human" || dto.source === "user";
  const px = (v) => ({ x: v.x * imageWidth, y: v.y * imageHeight, width: v.w * imageWidth, height: v.h * imageHeight });
  const proposal = dto.proposition ? { label: dto.proposition.label, fdi: dto.proposition.fdi ?? null, ...px(dto.proposition) } : null;
  return {
    id: dto.id,
    label: dto.label,
    fdi: dto.fdi ?? null,
    // Confiance en pourcentage entier ; null pour un ajout du praticien.
    confidence: fromUser ? null : Math.round((dto.confidence ?? 0) * 100),
    x: dto.x * imageWidth,
    y: dto.y * imageHeight,
    width: dto.w * imageWidth,
    height: dto.h * imageHeight,
    modelVersion: dto.model_version ?? "",
    source: fromUser ? "user" : "ai",
    status: dto.etat ? reviewStatus(dto.etat, fromUser) : fromUser ? ReviewStatus.ADDED : dto.reviewed ? ReviewStatus.VALIDATED : ReviewStatus.PENDING,
    // Relecture : commentaire du verdict courant, auteur, proposition d'origine, historique.
    comment: dto.commentaire ?? "",
    reviewedBy: dto.revu_par_nom ?? null,
    reviewedAt: dto.revu_le ?? null,
    proposal,
    history: (dto.verdicts ?? []).map((v) => ({
      action: v.action,
      label: v.label,
      fdi: v.fdi ?? null,
      comment: v.commentaire ?? "",
      author: v.auteur_nom ?? null,
      at: v.cree_le,
      cancelledAt: v.annule_le ?? null,
    })),
  };
}
