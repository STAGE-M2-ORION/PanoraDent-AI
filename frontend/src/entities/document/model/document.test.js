import { describe, expect, it } from "vitest";

import {
  documentsToReindex, formatSize, hasPendingDocuments, normalizeLibrary, parseSettings, validateDocumentFile,
} from "./document";

const DTO = {
  documents: [
    { id: "d1", titre: "Guide", nom_fichier: "guide.md", format: "markdown", taille: 1536, etat: "indexe", erreur: null,
      nb_passages: 4, modele_vecteurs: "bge-m3", perime: false, depose_le: "2026-11-26T08:00:00", depose_par_nom: "Admin",
      indexe_le: "2026-11-26T08:01:00" },
    { id: "d 2", titre: "Ancien", nom_fichier: "a.pdf", format: "pdf", taille: 10, etat: "echec", erreur: "Aucun texte",
      nb_passages: 0, perime: false },
    { id: "d3", titre: "Périmé", nom_fichier: "p.md", format: "markdown", taille: 5, etat: "indexe", perime: true },
  ],
  index: { modele: "bge-m3", documents: 3, passages: 9, passages_perimes: 5, documents_perimes: 1,
           par_etat: { en_attente: 0, en_cours: 0, indexe: 2, echec: 1 } },
  parametres: { passages: 5, seuil: 0.5 },
};

describe("base documentaire", () => {
  it("réponse → modèle : documents, index, réglages", () => {
    const lib = normalizeLibrary(DTO);
    expect(lib.documents[0]).toMatchObject({ title: "Guide", state: "indexe", passages: 4, uploadedBy: "Admin", stale: false });
    expect(lib.documents[1]).toMatchObject({ state: "echec", error: "Aucun texte" });
    expect(lib.documents[1].fileUrl).toMatch(/\/documents\/d%202\/fichier$/);
    expect(lib.index).toEqual({ model: "bge-m3", documents: 3, passages: 9, stalePassages: 5, staleDocuments: 1, failed: 1 });
    expect(lib.settings).toMatchObject({ passages: 5, threshold: 0.5 });
  });

  it("documents à suivre et à réindexer", () => {
    const { documents } = normalizeLibrary(DTO);
    expect(hasPendingDocuments(documents)).toBe(false);
    expect(hasPendingDocuments([{ state: "en_cours" }])).toBe(true);
    expect(documentsToReindex(documents)).toBe(2);
  });

  it("taille lisible", () => {
    expect(formatSize(12)).toBe("12 o");
    expect(formatSize(1536)).toBe("2 Ko");
    expect(formatSize(1.25 * 1024 * 1024)).toBe("1,3 Mo");
  });

  it("contrôle du fichier avant envoi", () => {
    expect(validateDocumentFile({ name: "guide.MD", size: 10 })).toBeNull();
    expect(validateDocumentFile({ name: "notes.txt", size: 10 })).toMatch(/PDF ou Markdown/);
    expect(validateDocumentFile({ name: "a.pdf", size: 0 })).toMatch(/vide/);
    expect(validateDocumentFile({ name: "a.pdf", size: 21 * 1024 * 1024 })).toMatch(/20 Mo/);
  });

  it("réglages saisis → corps envoyé", () => {
    expect(parseSettings({ passages: "4", threshold: "0,55" })).toEqual({ payload: { passages: 4, seuil: 0.55 } });
    expect(parseSettings({ passages: "0", threshold: "0.5" }).error).toMatch(/1 à 10/);
    expect(parseSettings({ passages: "3", threshold: "1.2" }).error).toMatch(/0 à 1/);
  });
});
