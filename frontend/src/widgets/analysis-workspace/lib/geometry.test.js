import { describe, expect, it } from "vitest";

import { normalizeDetection } from "@/entities/detection";

import { ZOOM_MAX, ZOOM_MIN, boxToScreen, imageToScreen, screenToImage, zoomAround } from "./geometry";

const W = 2000;
const H = 1000;
const view0 = { zoom: 1, tx: 40, ty: 30, base: 800 };

/** Rectangle à l'écran de la zone d'image couverte par un cadre (via ses deux coins). */
const imageRegion = (box, view) => {
  const a = imageToScreen({ x: box.x, y: box.y }, view, W);
  const b = imageToScreen({ x: box.x + box.w, y: box.y + box.h }, view, W);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
};

describe("cadres alignés sur l'image, quel que soit le zoom", () => {
  // Boîte reçue du serveur en fractions, ramenée aux pixels de l'image.
  const det = normalizeDetection({ id: "d", label: "caries", fdi: 36, confidence: 0.9, x: 0.6, y: 0.4, w: 0.05, h: 0.12 }, { imageWidth: W, imageHeight: H });
  const box = { x: det.x, y: det.y, w: det.width, h: det.height };

  it("fractions → pixels", () => {
    expect(box.x).toBeCloseTo(1200);
    expect(box.y).toBeCloseTo(400);
    expect(box.w).toBeCloseTo(100);
    expect(box.h).toBeCloseTo(120);
  });

  it.each([
    ["zoom avant au centre", [[2, 400, 200]]],
    ["zoom avant répété sur le cadre", [[1.25, 520, 190], [1.25, 520, 190], [1.25, 520, 190]]],
    ["zoom arrière puis avant ailleurs", [[0.8, 0, 0], [3, 700, 350]]],
  ])("%s : le cadre couvre toujours la même zone de l'image", (_, steps) => {
    let view = view0;
    steps.forEach(([f, x, y]) => {
      view = zoomAround(view, f, x, y);
    });
    const drawn = boxToScreen(box, view, W);
    const region = imageRegion(box, view);
    expect(drawn.x).toBeCloseTo(region.x, 6);
    expect(drawn.y).toBeCloseTo(region.y, 6);
    expect(drawn.w).toBeCloseTo(region.w, 6);
    expect(drawn.h).toBeCloseTo(region.h, 6);
    // Taille à l'écran proportionnelle au zoom.
    expect(drawn.w / boxToScreen(box, view0, W).w).toBeCloseTo(view.zoom / view0.zoom, 6);
  });

  it("le point sous le curseur reste immobile pendant le zoom", () => {
    const cursor = { x: 333, y: 222 };
    const before = screenToImage(cursor, view0, W);
    const after = screenToImage(cursor, zoomAround(view0, 2.5, cursor.x, cursor.y), W);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("écran → image → écran : aller-retour exact", () => {
    const view = zoomAround(view0, 3, 100, 100);
    const p = screenToImage(imageToScreen({ x: 1234, y: 567 }, view, W), view, W);
    expect(p.x).toBeCloseTo(1234, 6);
    expect(p.y).toBeCloseTo(567, 6);
  });

  it("zoom borné", () => {
    expect(zoomAround(view0, 100, 0, 0).zoom).toBe(ZOOM_MAX);
    expect(zoomAround(view0, 0.01, 0, 0).zoom).toBe(ZOOM_MIN);
  });
});
