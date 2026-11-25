import { describe, expect, it } from "vitest";

import { normalizeAnswer } from "./answer";
import {
  appendToConclusion, clipboardText, conclusionBlock, normalizeConversation, parseEventStream,
} from "./conversation";

describe("fil de l'assistant", () => {
  it("DTO → messages, suggestions, lecture seule", () => {
    const c = normalizeConversation({
      messages: [
        { id: "q1", role: "question", statut: null, texte: "Que signifie LPA ?", sources: [] },
        { id: "r1", role: "reponse", statut: "reponse", texte: "Une zone sombre [1].",
          sources: [{ numero: 1, document_id: "d1", titre: "Guide", format: "markdown", extrait: "…" }] },
        { id: "q2", role: "question", texte: "Et la 36 ?" },
        { id: "r2", role: "reponse", statut: "interrompue", texte: "Réponse interrompue.", sources: [] },
      ],
      suggestions: ["Comment lire la carie signalée sur la dent 36 ?"],
      lecture_seule: true,
      avertissement: "Pas de diagnostic.",
    });
    expect(c.messages[0]).toEqual({ id: "q1", who: "user", text: "Que signifie LPA ?" });
    expect(c.messages[1].answer).toMatchObject({ status: "answer", warning: "Pas de diagnostic." });
    expect(c.messages[1].answer.sources[0].title).toBe("Guide");
    expect(c.messages[3].answer.status).toBe("interrupted");
    expect(c.readOnly).toBe(true);
    expect(c.suggestions).toHaveLength(1);
  });

  it("flux d'événements lu par morceaux", () => {
    const a = parseEventStream('event: debut\ndata: {"passages": 2}\n\nevent: fragment\ndata: {"texte": "Une "}\n\nevent: frag');
    expect(a.events).toEqual([{ type: "debut", data: { passages: 2 } }, { type: "fragment", data: { texte: "Une " } }]);
    const b = parseEventStream(`${a.rest}ment\ndata: {"texte": "zone"}\n\n`);
    expect(b.events).toEqual([{ type: "fragment", data: { texte: "zone" } }]);
    expect(b.rest).toBe("");
    expect(parseEventStream("event: x\ndata: pas du json\n\n").events).toEqual([]);
  });

  it("insertion dans la conclusion : marquée, sources en clair", () => {
    const answer = normalizeAnswer({
      statut: "reponse",
      texte: "Une zone radio-claire autour de l'apex [1]. Le seuil compte [2][1].",
      sources: [
        { numero: 1, document_id: "d1", titre: "Guide", section: "Lésions", page: null },
        { numero: 2, document_id: "d2", titre: "Manuel", format: "pdf", page: 12 },
      ],
    });
    const block = conclusionBlock(answer);
    expect(block).toBe("[Assistant documentaire] Une zone radio-claire autour de l'apex. Le seuil compte. (Sources : Guide — Lésions ; Manuel — page 12.)");
    expect(appendToConclusion("", block)).toBe(block);
    expect(appendToConclusion("Contrôle à 6 mois.  ", block)).toBe(`Contrôle à 6 mois.\n\n${block}`);
    expect(clipboardText(answer)).toContain("Sources :\n[1] Guide — Lésions\n[2] Manuel — page 12");
  });
});
