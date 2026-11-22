import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
vi.mock("@/shared/api", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, httpClient: { get: vi.fn(), post: (...a) => post(...a), put: vi.fn(), delete: vi.fn() } };
});

import { normalizeDetection, reviewStatus } from "@/entities/detection";

import { makeReview, reviewSummary, verdictOfStatus } from "./review-api";

const dto = (over = {}) => ({
  id: "d1",
  label: "deep_caries",
  fdi: 37,
  confidence: 0.55,
  x: 0.3,
  y: 0.32,
  w: 0.02,
  h: 0.04,
  source: "model",
  model_version: "dentex-1.2",
  etat: "a_revoir",
  commentaire: "",
  proposition: { label: "deep_caries", fdi: 37, x: 0.3, y: 0.32, w: 0.02, h: 0.04 },
  verdicts: [],
  ...over,
});
const api = { id: "a1", width: 2000, height: 1000 };
const viewDet = { id: "d1", label: "deep_caries", fdi: 37, status: "pending", source: "ai", note: "", box: { x: 600, y: 320, w: 40, h: 40 } };

beforeEach(() => post.mockReset());

describe("état serveur → statut affiché", () => {
  it("quatre états, et l'ajout du praticien", () => {
    expect(reviewStatus("a_revoir", false)).toBe("pending");
    expect(reviewStatus("validee", false)).toBe("validated");
    expect(reviewStatus("corrigee", false)).toBe("corrected");
    expect(reviewStatus("rejetee", false)).toBe("rejected");
    expect(reviewStatus("validee", true)).toBe("added");
    expect(reviewStatus("rejetee", true)).toBe("rejected");
  });

  it("valeurs retenues, proposition d'origine et historique, en pixels", () => {
    const d = normalizeDetection(
      dto({
        label: "caries",
        fdi: 36,
        etat: "corrigee",
        commentaire: "Émail seul",
        revu_par_nom: "Dr Rabe",
        verdicts: [{ action: "corriger", label: "caries", fdi: 36, commentaire: "Émail seul", auteur_nom: "Dr Rabe", cree_le: "2026-11-21T07:00:00", annule_le: null }],
      }),
      { imageWidth: 2000, imageHeight: 1000 },
    );
    expect(d).toMatchObject({ label: "caries", fdi: 36, status: "corrected", comment: "Émail seul", reviewedBy: "Dr Rabe" });
    expect(d.proposal).toMatchObject({ label: "deep_caries", fdi: 37, x: 600, y: 320 });
    expect(d.history[0]).toMatchObject({ action: "corriger", author: "Dr Rabe", cancelledAt: null });
  });
});

describe("relecture d'une vraie analyse : appels au serveur", () => {
  it("valider : action et commentaire seulement", async () => {
    post.mockResolvedValue({ data: dto({ etat: "validee", commentaire: "Net" }) });
    const d = await makeReview({ api }).verdict(viewDet, "valider", { comment: "Net" });
    expect(post).toHaveBeenCalledWith("/analyses/a1/detections/d1/verdict", { action: "valider", commentaire: "Net" });
    expect(d.status).toBe("validated");
    expect(d.note).toBe("Net");
  });

  it("corriger : seules les valeurs changées partent, le cadre en fractions", async () => {
    post.mockResolvedValue({ data: dto({ etat: "corrigee", label: "caries" }) });
    await makeReview({ api }).verdict(viewDet, "corriger", {
      label: "caries",
      fdi: 37, // inchangée : non envoyée
      box: { x: 620, y: 320, w: 40, h: 40 },
      originalBox: viewDet.box,
    });
    expect(post.mock.calls[0][1]).toEqual({ action: "corriger", label: "caries", cadre: { x: 0.31, y: 0.32, w: 0.02, h: 0.04 } });
  });

  it("corriger sans toucher au cadre : pas de cadre envoyé", async () => {
    post.mockResolvedValue({ data: dto({ etat: "corrigee", fdi: 36 }) });
    await makeReview({ api }).verdict(viewDet, "corriger", { fdi: 36, box: viewDet.box, originalBox: viewDet.box });
    expect(post.mock.calls[0][1]).toEqual({ action: "corriger", fdi: 36 });
  });

  it("annuler un ajout : la détection est retirée (null)", async () => {
    post.mockResolvedValue({ data: { detection: null, retiree_id: "d9" } });
    expect(await makeReview({ api }).undo({ id: "d9" })).toBeNull();
    expect(post).toHaveBeenCalledWith("/analyses/a1/detections/d9/annuler");
  });

  it("ajouter : cadre tracé en pixels → fractions bornées", async () => {
    post.mockResolvedValue({ data: dto({ id: "d9", source: "human", confidence: null, etat: "validee" }) });
    const d = await makeReview({ api }).add({ label: "impacted_tooth", fdi: 48, box: { x: 1900, y: 900, w: 200, h: 200 }, note: " " });
    expect(post.mock.calls[0][1]).toEqual({ label: "impacted_tooth", fdi: 48, cadre: { x: 0.95, y: 0.9, w: 0.05, h: 0.1 }, commentaire: null });
    expect(d).toMatchObject({ status: "added", source: "user", confidence: null });
  });
});

describe("démonstration : mêmes gestes, rien n'est envoyé", () => {
  it("verdict puis annulation reviennent à l'état initial", async () => {
    const r = makeReview({ api: null }, "Dr Démo");
    const rejected = await r.verdict(viewDet, "rejeter", { comment: "Artefact" });
    expect(rejected).toMatchObject({ status: "rejected", note: "Artefact", reviewedBy: "Dr Démo" });
    const back = await r.undo(rejected);
    expect(back.status).toBe("pending");
    expect(post).not.toHaveBeenCalled();
  });

  it("un ajout annulé disparaît", async () => {
    const r = makeReview({ api: null }, "Dr Démo");
    const added = await r.add({ label: "caries", fdi: 45, box: { x: 1, y: 1, w: 20, h: 20 }, note: "" });
    expect(added.status).toBe("added");
    expect(await r.undo(added)).toBeNull();
  });
});

describe("écran de clôture et commentaire", () => {
  it("décompte par statut", () => {
    const s = reviewSummary([{ status: "pending" }, { status: "validated" }, { status: "validated" }, { status: "rejected" }, { status: "added" }]);
    expect(s).toEqual({ total: 5, pending: 1, validated: 2, corrected: 0, rejected: 1, added: 1 });
  });

  it("changer le seul commentaire repose le verdict courant", () => {
    expect(verdictOfStatus("corrected")).toBe("corriger");
    expect(verdictOfStatus("rejected")).toBe("rejeter");
    expect(verdictOfStatus("validated")).toBe("valider");
    expect(verdictOfStatus("added")).toBe("valider");
  });
});
