import { normalizeAnswer, sourceOrigin } from "./answer";

/**
 * Fil de l'assistant d'une analyse (sprint 10) : `GET /analyses/{id}/conversation`.
 * Chaque praticien a le sien ; après clôture, il est en lecture seule.
 */
export function normalizeMessage(dto, warning = "") {
  if (dto.role === "question") return { id: dto.id, who: "user", text: dto.texte };
  return {
    id: dto.id,
    who: "bot",
    answer: normalizeAnswer({ statut: dto.statut, texte: dto.texte, sources: dto.sources, avertissement: warning }),
  };
}

export function normalizeConversation(dto) {
  const warning = dto.avertissement ?? "";
  return {
    messages: (dto.messages ?? []).map((m) => normalizeMessage(m, warning)),
    suggestions: dto.suggestions ?? [],
    readOnly: Boolean(dto.lecture_seule),
    warning,
  };
}

/**
 * Lecture d'un flux d'événements (`text/event-stream`) reçu par morceaux :
 * renvoie les événements complets du tampon et le reste, à compléter par le
 * morceau suivant. Un événement se termine par une ligne vide.
 */
export function parseEventStream(buffer) {
  const events = [];
  const blocks = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = blocks.pop();
  for (const block of blocks) {
    let type = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) continue;
    try {
      events.push({ type, data: JSON.parse(data.join("\n")) });
    } catch {
      /* événement illisible : ignoré */
    }
  }
  return { events, rest };
}

/**
 * Réponse insérée dans la conclusion : marquée comme venant de l'assistant,
 * renvois remplacés par la liste des sources. Le praticien la relit et la
 * réécrit à sa guise : c'est lui qui signe la conclusion.
 */
export function conclusionBlock(answer) {
  const text = answer.text.replace(/\s*\[\d+\]/g, "").replace(/\s+([.,;:!?])/g, "$1").trim();
  const sources = answer.sources.map(sourceOrigin).join(" ; ");
  return `[Assistant documentaire] ${text}${sources ? ` (Sources : ${sources}.)` : ""}`;
}

/** Ajoute un bloc à la conclusion existante, séparé par une ligne vide. */
export function appendToConclusion(conclusion, block) {
  const current = String(conclusion ?? "").trimEnd();
  return current ? `${current}\n\n${block}` : block;
}

/** Texte copié dans le presse-papiers : la réponse et ses sources. */
export function clipboardText(answer) {
  const sources = answer.sources.map((s) => `[${s.number}] ${sourceOrigin(s)}`).join("\n");
  return sources ? `${answer.text}\n\nSources :\n${sources}` : answer.text;
}
