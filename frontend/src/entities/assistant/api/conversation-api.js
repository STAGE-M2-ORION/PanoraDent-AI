import { AppError, ErrorCode, errorFromResponse, fetchWithSession, httpClient } from "@/shared/api";

import { normalizeConversation, normalizeMessage, parseEventStream } from "../model/conversation";

const base = (analysisId) => `/analyses/${encodeURIComponent(analysisId)}/conversation`;

/** `GET /api/v1/analyses/{id}/conversation` — son fil, les suggestions, la lecture seule. */
export async function fetchConversation(analysisId) {
  const { data } = await httpClient.get(base(analysisId));
  return normalizeConversation(data);
}

/** `DELETE /api/v1/analyses/{id}/conversation` — efface son fil (journalisé). */
export async function deleteConversation(analysisId) {
  await httpClient.delete(base(analysisId));
}

/**
 * `POST /api/v1/analyses/{id}/conversation/flux` — réponse au fil de l'eau.
 *
 * `onFragment(texte)` reçoit le BROUILLON à mesure ; la promesse se résout
 * sur la réponse vérifiée et enregistrée : `{ question, answer, warning }`.
 * `signal` (AbortController) arrête la réponse : la connexion est coupée, le
 * serveur cesse de rédiger ; la promesse est alors rejetée (`AbortError`).
 */
export async function streamQuestion(analysisId, question, { signal, onStart, onFragment } = {}) {
  const response = await fetchWithSession(`${base(analysisId)}/flux`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!response.ok) throw await errorFromResponse(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseEventStream(buffer);
    buffer = rest;
    for (const event of events) {
      if (event.type === "debut") onStart?.(event.data.passages);
      else if (event.type === "fragment") onFragment?.(event.data.texte);
      else if (event.type === "fin") {
        const warning = event.data.avertissement ?? "";
        final = {
          question: normalizeMessage(event.data.question, warning),
          answer: normalizeMessage(event.data.reponse, warning),
          warning,
        };
      }
    }
  }
  if (!final) throw new AppError(ErrorCode.NETWORK, "La réponse s’est interrompue avant la fin. Réessayez.");
  return final;
}
