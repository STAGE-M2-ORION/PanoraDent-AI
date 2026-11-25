import { API_BASE_URL } from "@/shared/config";

/**
 * Base documentaire de l'assistant (sprint 9) : documents de référence,
 * état de l'index, réglages de la recherche. `GET /documents` → modèle.
 */
export const DOCUMENT_LIMITS = { bytes: 20 * 1024 * 1024, title: 200, passagesMin: 1, passagesMax: 10 };
export const DOCUMENT_EXTENSIONS = [".pdf", ".md", ".markdown"];

/** État d'un document → libellé et ton du badge. */
export const DOCUMENT_STATES = {
  en_attente: { label: "En attente", tone: "info" },
  en_cours: { label: "Indexation…", tone: "info" },
  indexe: { label: "Indexé", tone: "success" },
  echec: { label: "Échec", tone: "danger" },
};

export function normalizeDocument(dto) {
  return {
    id: dto.id,
    title: dto.titre,
    fileName: dto.nom_fichier,
    format: dto.format,
    size: dto.taille ?? 0,
    state: DOCUMENT_STATES[dto.etat] ? dto.etat : "en_attente",
    error: dto.erreur ?? null,
    passages: dto.nb_passages ?? 0,
    model: dto.modele_vecteurs ?? null,
    stale: Boolean(dto.perime),
    uploadedAt: dto.depose_le ?? null,
    uploadedBy: dto.depose_par_nom ?? null,
    indexedAt: dto.indexe_le ?? null,
    fileUrl: `${API_BASE_URL}/documents/${encodeURIComponent(dto.id)}/fichier`,
  };
}

export function normalizeSettings(dto = {}) {
  return {
    passages: dto.passages ?? 5,
    threshold: dto.seuil ?? 0.5,
    updatedAt: dto.maj_le ?? null,
    updatedBy: dto.maj_par_nom ?? null,
  };
}

export function normalizeLibrary(dto) {
  const index = dto.index ?? {};
  return {
    documents: (dto.documents ?? []).map(normalizeDocument),
    index: {
      model: index.modele ?? null,
      documents: index.documents ?? 0,
      passages: index.passages ?? 0,
      stalePassages: index.passages_perimes ?? 0,
      staleDocuments: index.documents_perimes ?? 0,
      failed: index.par_etat?.echec ?? 0,
    },
    settings: normalizeSettings(dto.parametres),
  };
}

/** Un document attend ou subit l'indexation : l'écran se rafraîchit. */
export function hasPendingDocuments(documents = []) {
  return documents.some((d) => d.state === "en_attente" || d.state === "en_cours");
}

/** Documents à réindexer d'un geste : périmés, ou en échec. */
export function documentsToReindex(documents = []) {
  return documents.filter((d) => d.stale || d.state === "echec").length;
}

/** « 1,2 Mo », « 840 Ko », « 12 o ». */
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

/** Contrôle avant envoi (le serveur revérifie le type réel). */
export function validateDocumentFile(file) {
  if (!file) return "Choisissez un fichier.";
  const name = String(file.name || "").toLowerCase();
  if (!DOCUMENT_EXTENSIONS.some((ext) => name.endsWith(ext))) return "Formats acceptés : PDF ou Markdown (.md).";
  if (file.size === 0) return "Le fichier est vide.";
  if (file.size > DOCUMENT_LIMITS.bytes) return "Le fichier dépasse 20 Mo.";
  return null;
}

/** Réglages saisis (texte des champs) → corps envoyé, ou message d'erreur. */
export function parseSettings({ passages, threshold }) {
  const n = Number(passages);
  const s = Number(String(threshold).replace(",", "."));
  if (!Number.isInteger(n) || n < DOCUMENT_LIMITS.passagesMin || n > DOCUMENT_LIMITS.passagesMax) {
    return { error: "Nombre de passages : un entier de 1 à 10." };
  }
  if (!Number.isFinite(s) || s < 0 || s > 1) return { error: "Seuil de similarité : un nombre de 0 à 1." };
  return { payload: { passages: n, seuil: Math.round(s * 100) / 100 } };
}
