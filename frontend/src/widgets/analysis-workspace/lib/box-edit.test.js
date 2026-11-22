import { describe, expect, it } from "vitest";

import { toFractionBox } from "@/entities/detection";

import { boxFromPoints, moveBox, resizeBox } from "./geometry";

const W = 2000;
const H = 1000;
const b = { x: 100, y: 100, w: 200, h: 100 };
const inside = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W + 1e-9 && r.y + r.h <= H + 1e-9;

describe("édition des cadres : toujours dans l'image", () => {
  it("déplacement libre à l'intérieur", () => {
    expect(moveBox(b, 50, 20, W, H)).toEqual({ x: 150, y: 120, w: 200, h: 100 });
  });

  it("déplacement borné aux quatre bords, taille conservée", () => {
    expect(moveBox(b, -500, -500, W, H)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(moveBox(b, 5000, 5000, W, H)).toEqual({ x: 1800, y: 900, w: 200, h: 100 });
  });

  it.each(["tl", "tr", "bl", "br"])("coin %s : le coin opposé reste fixe", (corner) => {
    const r = resizeBox(b, corner, 30, 40, W, H, 10);
    const fixed = { x: corner.includes("l") ? b.x + b.w : b.x, y: corner.includes("t") ? b.y + b.h : b.y };
    expect(corner.includes("l") ? r.x + r.w : r.x).toBe(fixed.x);
    expect(corner.includes("t") ? r.y + r.h : r.y).toBe(fixed.y);
  });

  it("redimensionnement borné à l'image et à la taille minimale", () => {
    expect(inside(resizeBox(b, "br", 9000, 9000, W, H, 10))).toBe(true);
    expect(resizeBox(b, "br", 9000, 9000, W, H, 10)).toEqual({ x: 100, y: 100, w: 1900, h: 900 });
    expect(resizeBox(b, "tl", -9000, -9000, W, H, 10)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    // Tirer un coin au-delà du coin opposé : le cadre garde son côté minimal.
    const r = resizeBox(b, "br", -9000, -9000, W, H, 10);
    expect([r.w, r.h]).toEqual([10, 10]);
  });

  it("tracé dans n'importe quel sens, borné à l'image", () => {
    expect(boxFromPoints({ x: 300, y: 200 }, { x: 100, y: 50 }, W, H)).toEqual({ x: 100, y: 50, w: 200, h: 150 });
    expect(boxFromPoints({ x: 1900, y: 900 }, { x: 2500, y: 1400 }, W, H)).toEqual({ x: 1900, y: 900, w: 100, h: 100 });
  });
});

describe("envoi au serveur : fractions bornées à [0, 1]", () => {
  it("pixels → fractions, arrondies à 6 décimales", () => {
    expect(toFractionBox({ x: 500, y: 250, w: 100, h: 50 }, W, H)).toEqual({ x: 0.25, y: 0.25, w: 0.05, h: 0.05 });
    expect(toFractionBox({ x: 1, y: 1, w: 1, h: 1 }, 3, 3)).toEqual({ x: 0.333333, y: 0.333333, w: 0.333333, h: 0.333333 });
  });

  it("un cadre qui déborde est ramené dans l'image", () => {
    const f = toFractionBox({ x: -40, y: 950, w: 200, h: 200 }, W, H);
    expect(f).toEqual({ x: 0, y: 0.95, w: 0.08, h: 0.05 });
    expect(f.x + f.w).toBeLessThanOrEqual(1);
    expect(f.y + f.h).toBeLessThanOrEqual(1);
  });

  it("indépendant du zoom : mêmes fractions pour la même zone de l'image", () => {
    // Le cadre est édité en pixels de l'IMAGE (jamais de l'écran) : le zoom n'y entre pas.
    const zone = { x: 1200, y: 400, w: 100, h: 120 };
    expect(toFractionBox(zone, W, H)).toEqual({ x: 0.6, y: 0.4, w: 0.05, h: 0.12 });
  });
});
