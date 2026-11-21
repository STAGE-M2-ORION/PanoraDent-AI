import { describe, expect, it } from "vitest";

import { AnalysisStatus, Processing, displayStatus, normalizeAnalysis, normalizeAnalysisSummary, normalizeProcessing } from "./analysis";

const dto = (over = {}) => ({
  id: "a1",
  reference: "PDX-2026-0001",
  created_at: "2026-11-20T10:00:00",
  image_key: "k",
  model_version: "yolo-1.0",
  inference_mode: "model",
  width: 2000,
  height: 1000,
  statut: "terminee",
  duree_ms: 3200,
  detections: [{ id: "d1", label: "caries", fdi: 36, confidence: 0.874, x: 0.25, y: 0.5, w: 0.05, h: 0.1, source: "model", model_version: "yolo-1.0" }],
  ...over,
});

describe("normalisation d'une analyse (sprint 4)", () => {
  it("boîtes reçues en fractions de l'image → pixels de l'image", () => {
    const [d] = normalizeAnalysis(dto()).detections;
    expect(d).toMatchObject({ x: 500, y: 500, width: 100, height: 100, confidence: 87, modelVersion: "yolo-1.0" });
  });

  it("statut de la file, durée et tentatives", () => {
    const a = normalizeAnalysis(dto({ statut: "echouee", erreur: "Le service d'analyse ne répond pas.", tentatives: 3, detections: [] }));
    expect(a).toMatchObject({ processing: Processing.FAILED, status: AnalysisStatus.FAILED, attempts: 3, error: "Le service d'analyse ne répond pas." });
    expect(normalizeAnalysis(dto()).durationMs).toBe(3200);
  });

  it("statut affiché : la file d'abord, puis la relecture", () => {
    expect(displayStatus(Processing.QUEUED, false)).toBe(AnalysisStatus.QUEUED);
    expect(displayStatus(Processing.RUNNING, false)).toBe(AnalysisStatus.RUNNING);
    expect(displayStatus(Processing.FAILED, true)).toBe(AnalysisStatus.FAILED);
    expect(displayStatus(Processing.DONE, false)).toBe(AnalysisStatus.PENDING);
    expect(displayStatus(Processing.DONE, true)).toBe(AnalysisStatus.CLOSED);
  });

  it("résumé sans statut (ancien serveur) : considéré comme terminé", () => {
    expect(normalizeAnalysisSummary({ id: "a", n_detections: 2 }).status).toBe(AnalysisStatus.PENDING);
    expect(normalizeAnalysisSummary({ id: "a", statut: "en_file" }).status).toBe(AnalysisStatus.QUEUED);
  });

  it("suivi de la file : position et motif d'échec", () => {
    expect(normalizeProcessing({ id: "a", statut: "en_file", position: 2, tentatives: 0 })).toEqual({
      id: "a",
      processing: "en_file",
      error: "",
      attempts: 0,
      durationMs: null,
      position: 2,
    });
  });

  it("relecture : en cours dès un premier verdict, clôturée d'après le serveur", () => {
    expect(displayStatus(Processing.DONE, false, 0)).toBe(AnalysisStatus.PENDING);
    expect(displayStatus(Processing.DONE, false, 2)).toBe(AnalysisStatus.IN_PROGRESS);
    expect(displayStatus(Processing.DONE, true, 2)).toBe(AnalysisStatus.CLOSED);
    const a = normalizeAnalysis(dto({ cloturee: true, cloturee_par_nom: "Dr Rabe", conclusion: "RAS", avancement: { revues: 3, total: 3 } }));
    expect(a).toMatchObject({ closed: true, closedBy: "Dr Rabe", conclusion: "RAS", progress: { reviewed: 3, total: 3 }, status: AnalysisStatus.CLOSED });
    expect(normalizeAnalysisSummary({ id: "a", statut: "terminee", revues: 1, a_revoir: 2 })).toMatchObject({ status: AnalysisStatus.IN_PROGRESS, toReview: 2 });
  });
});
