import { afterEach, describe, expect, it, vi } from "vitest";

import { httpClient, toAppError } from "@/shared/api";

import { fetchReportDownload, fetchReportPreview, fileNameFrom, toReportParams } from "./report-api";

afterEach(() => vi.restoreAllMocks());

describe("compte rendu : requêtes vers le serveur", () => {
  it("options de l'écran → paramètres ; brouillon et téléchargement distincts", () => {
    expect(toReportParams({ image: false, comments: true, rejected: true })).toEqual({
      image: false, commentaires: true, rejetees: true, brouillon: false, telecharger: false,
    });
    expect(toReportParams(undefined, { draft: true })).toMatchObject({ image: true, rejetees: false, brouillon: true });
  });

  it("nom du fichier annoncé par le serveur", () => {
    expect(fileNameFrom('attachment; filename="compte-rendu-PDX-2026-0003.pdf"')).toBe("compte-rendu-PDX-2026-0003.pdf");
    expect(fileNameFrom(undefined)).toBe("compte-rendu.pdf");
  });

  it("aperçu et téléchargement : même route, en binaire, avec les bons paramètres", async () => {
    const get = vi.spyOn(httpClient, "get").mockResolvedValue({
      data: new Blob(["%PDF"]), headers: { "content-disposition": 'inline; filename="compte-rendu-PDX-1-brouillon.pdf"' },
    });
    const apercu = await fetchReportPreview("a1", { image: true, comments: false, rejected: false }, { draft: true });
    expect(apercu.fileName).toBe("compte-rendu-PDX-1-brouillon.pdf");
    expect(get).toHaveBeenLastCalledWith("/analyses/a1/compte-rendu", {
      params: { image: true, commentaires: false, rejetees: false, brouillon: true, telecharger: false }, responseType: "blob",
    });
    await fetchReportDownload("a1", { image: true, comments: true, rejected: true });
    expect(get.mock.calls.at(-1)[1].params).toMatchObject({ telecharger: true, brouillon: false, rejetees: true });
  });

  it("le message du serveur remonte malgré la réponse binaire", async () => {
    const corps = new Blob([JSON.stringify({ code: "analyse_non_cloturee", message: "Clôturez la relecture pour produire le compte rendu." })]);
    vi.spyOn(httpClient, "get").mockRejectedValue({ response: { status: 409, data: corps } });
    const erreur = await fetchReportDownload("a1", {}).catch((e) => toAppError(e));
    expect(erreur.message).toBe("Clôturez la relecture pour produire le compte rendu.");
    expect(erreur.serverCode).toBe("analyse_non_cloturee");
  });
});
