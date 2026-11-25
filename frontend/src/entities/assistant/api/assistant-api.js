import { httpClient } from "@/shared/api";

import { normalizeAnswer } from "../model/answer";

/**
 * `POST /api/v1/assistant/questions` — permission `assistant:use`. La question
 * posée depuis une analyse emporte son contexte ANONYME (construit par le
 * serveur) ; elle est inscrite au journal avec la réponse et ses sources.
 * Rédaction sur processeur : jusqu'à quelques minutes.
 */
export async function askAssistant({ question, analysisId }) {
  const { data } = await httpClient.post(
    "/assistant/questions",
    { question, ...(analysisId ? { analyse_id: analysisId } : {}) },
    { timeout: 300_000 },
  );
  return normalizeAnswer(data);
}
