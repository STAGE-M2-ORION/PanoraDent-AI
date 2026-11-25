import { API_BASE_URL } from "@/shared/config";

/**
 * Réponse de l'assistant documentaire (`POST /assistant/questions`) → modèle.
 *
 * Trois issues : `answer` (réponse sourcée), `refusal` (rien de pertinent dans
 * la documentation : l'assistant préfère se taire), `failure` (réponse sans
 * source valide, ou service indisponible). Seule la première porte des sources.
 */
export const AnswerStatus = { ANSWER: "answer", REFUSAL: "refusal", FAILURE: "failure" };

const STATUSES = { reponse: AnswerStatus.ANSWER, refus: AnswerStatus.REFUSAL, echec: AnswerStatus.FAILURE };

export const QUESTION_LIMITS = { min: 3, max: 1000 };

function sourceUrl(src) {
  const base = `${API_BASE_URL}/documents/${encodeURIComponent(src.document_id)}/fichier`;
  // Le lecteur PDF du navigateur ouvre directement la page citée.
  return src.format === "pdf" && src.page ? `${base}#page=${src.page}` : base;
}

export function normalizeAnswer(dto) {
  return {
    status: STATUSES[dto.statut] ?? AnswerStatus.FAILURE,
    text: dto.texte ?? "",
    warning: dto.avertissement ?? "",
    sources: (dto.sources ?? []).map((s) => ({
      number: s.numero,
      documentId: s.document_id,
      title: s.titre,
      section: s.section ?? null,
      page: s.page ?? null,
      excerpt: s.extrait ?? "",
      url: sourceUrl(s),
    })),
  };
}

/**
 * Texte de la réponse → fragments et renvois : « Une zone sombre [1]. » →
 * ["Une zone sombre ", 1, "."]. Un renvoi sans source correspondante reste du
 * texte (le serveur les refuse de toute façon).
 */
export function citationParts(text, sources = []) {
  const known = new Set(sources.map((s) => s.number));
  const parts = [];
  let last = 0;
  for (const m of String(text).matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (!known.has(n)) continue;
    const before = text.slice(last, m.index);
    if (before) parts.push(before);
    parts.push(n);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Provenance lisible d'une source : « Guide — Lésions › Signes — page 3 ». */
export function sourceOrigin(src) {
  return [src.title, src.section, src.page ? `page ${src.page}` : null].filter(Boolean).join(" — ");
}

/** Contrôle avant envoi (le serveur revérifie). */
export function validateQuestion(text) {
  const q = String(text ?? "").replace(/\s+/g, " ").trim();
  if (q.length < QUESTION_LIMITS.min) return "Posez une question d’au moins trois caractères.";
  if (q.length > QUESTION_LIMITS.max) return "La question ne doit pas dépasser 1000 caractères.";
  return null;
}
