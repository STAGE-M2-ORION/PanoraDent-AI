import { describe, expect, it } from "vitest";

import { AnswerStatus, citationParts, normalizeAnswer, sourceOrigin, validateQuestion } from "./answer";

const DTO = {
  statut: "reponse",
  texte: "Une zone radio-claire autour de l'apex [1]. Le seuil règle les propositions [2][1].",
  avertissement: "L'assistant ne pose pas de diagnostic.",
  sources: [
    { numero: 1, document_id: "d1", titre: "Guide", format: "markdown", section: "Lésions › Signes", page: null, extrait: "…zone radio-claire…" },
    { numero: 2, document_id: "d 2", titre: "Manuel", format: "pdf", section: null, page: 12, extrait: "…seuil…" },
  ],
};

describe("réponse de l'assistant", () => {
  it("DTO → modèle, lien vers la page citée d'un PDF", () => {
    const a = normalizeAnswer(DTO);
    expect(a.status).toBe(AnswerStatus.ANSWER);
    expect(a.warning).toMatch(/diagnostic/);
    expect(a.sources[0]).toMatchObject({ number: 1, title: "Guide", section: "Lésions › Signes", page: null });
    expect(a.sources[0].url).toMatch(/\/documents\/d1\/fichier$/);
    expect(a.sources[1].url).toMatch(/\/documents\/d%202\/fichier#page=12$/);
  });

  it("refus et échec, sans source", () => {
    expect(normalizeAnswer({ statut: "refus", texte: "Rien trouvé." })).toMatchObject({ status: "refusal", sources: [] });
    expect(normalizeAnswer({ statut: "echec", texte: "Indisponible." }).status).toBe("failure");
    expect(normalizeAnswer({ statut: "inconnu" }).status).toBe("failure");
  });

  it("texte → fragments et renvois aux sources", () => {
    const a = normalizeAnswer(DTO);
    expect(citationParts(a.text, a.sources)).toEqual([
      "Une zone radio-claire autour de l'apex ", 1, ". Le seuil règle les propositions ", 2, 1, ".",
    ]);
    // Un renvoi sans source reste du texte.
    expect(citationParts("Voir [7].", a.sources)).toEqual(["Voir [7]."]);
  });

  it("provenance lisible", () => {
    const [md, pdf] = normalizeAnswer(DTO).sources;
    expect(sourceOrigin(md)).toBe("Guide — Lésions › Signes");
    expect(sourceOrigin(pdf)).toBe("Manuel — page 12");
  });

  it("contrôle de la question", () => {
    expect(validateQuestion("  a ")).toMatch(/trois caractères/);
    expect(validateQuestion("x".repeat(1001))).toMatch(/1000/);
    expect(validateQuestion("Que signifie LPA ?")).toBeNull();
  });
});
