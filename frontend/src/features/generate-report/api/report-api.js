import { httpClient } from "@/shared/api";

/**
 * Compte rendu PDF (sprint 8) : `GET /api/v1/analyses/{id}/compte-rendu`.
 * Reconstruit par le serveur à chaque demande (rien n'est stocké), identique
 * d'une fois à l'autre ; chaque aperçu et chaque téléchargement est journalisé.
 *
 * Options : `image`, `comments`, `rejected` ; `draft` pour l'aperçu d'une
 * analyse non clôturée (filigrane « BROUILLON », non téléchargeable).
 */
export const DEFAULT_REPORT_OPTIONS = { image: true, comments: true, rejected: false };

/** Options de l'écran → paramètres de la requête. */
export function toReportParams({ image = true, comments = true, rejected = false } = {}, { draft = false, download = false } = {}) {
  return { image, commentaires: comments, rejetees: rejected, brouillon: draft, telecharger: download };
}

/** Nom du fichier annoncé par le serveur (`Content-Disposition`), sinon un nom par défaut. */
export function fileNameFrom(disposition, fallback = "compte-rendu.pdf") {
  const m = /filename="?([^";]+)"?/i.exec(disposition ?? "");
  return m ? m[1] : fallback;
}

/**
 * Réponse demandée en binaire : une erreur du serveur arrive alors comme un
 * Blob. On la relit en JSON pour que son message (« Clôturez la relecture… »)
 * remonte tel quel, et non un simple « erreur 409 ».
 */
export async function withJsonErrorBody(error) {
  const data = error?.response?.data;
  if (data && typeof data.text === "function") {
    try {
      error.response.data = JSON.parse(await data.text());
    } catch {
      /* corps illisible : le message générique selon le statut s'appliquera */
    }
  }
  return error;
}

async function requestPdf(analysisId, options, mode) {
  try {
    const { data, headers } = await httpClient.get(`/analyses/${analysisId}/compte-rendu`, {
      params: toReportParams(options, mode),
      responseType: "blob",
    });
    return { blob: data, fileName: fileNameFrom(headers?.["content-disposition"]) };
  } catch (error) {
    throw await withJsonErrorBody(error);
  }
}

/** Aperçu (affiché, journalisé comme « généré »). */
export function fetchReportPreview(analysisId, options, { draft = false } = {}) {
  return requestPdf(analysisId, options, { draft });
}

/** Téléchargement du compte rendu définitif (journalisé comme « téléchargé »). */
export function fetchReportDownload(analysisId, options) {
  return requestPdf(analysisId, options, { download: true });
}
