import { afterEach, describe, expect, it, vi } from "vitest";

// Tout appel au serveur ferait échouer le test.
vi.mock("@/shared/api", async (importOriginal) => {
  const real = await importOriginal();
  const forbidden = () => {
    throw new Error("appel réseau interdit");
  };
  return { ...real, httpClient: { get: vi.fn(forbidden), post: vi.fn(forbidden), put: vi.fn(forbidden), patch: vi.fn(forbidden), delete: vi.fn(forbidden) } };
});

import { normalizeAnalysis } from "@/entities/analysis";
import { httpClient } from "@/shared/api";

import { buildAnnotations, exportFileName } from "../lib/export-png";
import { isVisible, realViewModel, stepDetection } from "./view-model";

const ALL = { tooth: true, caries: true, deep_caries: true, periapical_lesion: true, impacted_tooth: true };
const det = (id, label, confidence, fdi) => ({ id, label, confidence, fdi, status: "pending", source: confidence == null ? "user" : "ai", box: { x: 0, y: 0, w: 10, h: 10 } });
const dets = [det("a", "caries", 92, 16), det("b", "caries", 45, 26), det("c", "deep_caries", 60, 36), det("d", "periapical_lesion", 15, 46), det("u", "caries", null, 11)];

afterEach(() => vi.unstubAllGlobals());

describe("seuil de confiance et calques : filtrage local", () => {
  it("le seuil filtre sans aucun appel réseau", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const shown = (threshold) => dets.filter((d) => isVisible(d, { show: ALL, threshold })).map((d) => d.id);
    expect(shown(0)).toEqual(["a", "b", "c", "d", "u"]);
    expect(shown(50)).toEqual(["a", "c", "u"]);
    expect(shown(95)).toEqual(["u"]); // un ajout du praticien reste toujours affiché
    expect(fetchSpy).not.toHaveBeenCalled();
    Object.values(httpClient).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it("calque masqué : ses détections disparaissent, quel que soit le seuil", () => {
    const show = { ...ALL, caries: false };
    expect(dets.filter((d) => isVisible(d, { show, threshold: 0 })).map((d) => d.id)).toEqual(["c", "d"]);
  });
});

describe("raccourcis J / K : détection suivante ou précédente", () => {
  const visible = dets.filter((d) => isVisible(d, { show: ALL, threshold: 50 })); // dents 11 (u), 16 (a), 36 (c)

  it("dans l'ordre de la liste, en boucle", () => {
    expect(stepDetection(visible, "u", 1, "tooth")).toBe("a");
    expect(stepDetection(visible, "a", 1, "tooth")).toBe("c");
    expect(stepDetection(visible, "c", 1, "tooth")).toBe("u");
    expect(stepDetection(visible, "u", -1, "tooth")).toBe("c");
  });

  it("sans sélection : la première, ou la dernière en arrière ; liste vide : rien", () => {
    expect(stepDetection(visible, null, 1, "tooth")).toBe("u");
    expect(stepDetection(visible, null, -1, "tooth")).toBe("c");
    expect(stepDetection([], null, 1, "tooth")).toBeNull();
  });

  it("une détection passée sous le seuil n'est plus atteinte", () => {
    const ids = new Set();
    let cur = null;
    for (let i = 0; i < 6; i += 1) {
      cur = stepDetection(visible, cur, 1, "tooth");
      ids.add(cur);
    }
    expect([...ids].sort()).toEqual(["a", "c", "u"]);
  });
});

describe("analyse réelle → modèle de la vue et export", () => {
  const analysis = normalizeAnalysis({
    id: "x",
    reference: "PDX-2026-0042",
    created_at: "2026-11-20T10:00:00",
    model_version: "yolo-1.0",
    width: 1000,
    height: 500,
    statut: "terminee",
    duree_ms: 1500,
    detections: [
      { id: "t", label: "tooth", fdi: 36, confidence: 0.99, x: 0.1, y: 0.2, w: 0.05, h: 0.2, source: "model" },
      { id: "k", label: "caries", fdi: 36, confidence: 0.8, x: 0.1, y: 0.3, w: 0.02, h: 0.04, source: "model" },
      { id: "p", label: "periapical_lesion", fdi: 36, confidence: 0.3, x: 0.1, y: 0.35, w: 0.03, h: 0.03, source: "model" },
    ],
  });
  const vm = realViewModel(analysis, { imageUrl: "/storage/x", number: 42 });

  it("cadres en pixels, dents séparées des anomalies, durée conservée", () => {
    expect(vm.teeth).toHaveLength(1);
    expect(vm.teeth[0].box.x).toBeCloseTo(100);
    expect(vm.teeth[0].box.h).toBeCloseTo(100);
    expect(vm.dets.map((d) => d.id)).toEqual(["k", "p"]);
    expect(vm.dets[0].box.y).toBeCloseTo(150);
    expect(vm).toMatchObject({ processing: "terminee", durationMs: 1500, number: "0042" });
  });

  it("l'export reprend exactement ce qui est affiché", () => {
    const visible = (d) => isVisible(d, { show: ALL, threshold: 50 });
    const shapes = buildAnnotations(vm, vm.dets, { visible, show: ALL });
    expect(shapes.map((s) => s.kind)).toEqual(["tooth", "detection"]);
    expect(shapes[1]).toMatchObject({ text: "36 · 80 % · Carie", dashed: false });
    expect(buildAnnotations(vm, vm.dets, { visible, show: { ...ALL, tooth: false } })).toHaveLength(1);
  });

  it("nom du fichier exporté : la référence anonyme seule", () => {
    expect(exportFileName(vm)).toBe("panoradent-PDX-2026-0042-annotee.png");
  });
});
