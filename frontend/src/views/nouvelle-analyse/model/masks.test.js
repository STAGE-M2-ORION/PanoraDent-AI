import { describe, expect, it } from "vitest";

import { isUsable, rectFromPoints, round, toFraction, toStyle } from "./masks";

describe("géométrie des masques", () => {
  const box = { left: 100, top: 50, width: 800, height: 400 };

  it("pointeur → fraction de l'image, bornée", () => {
    expect(toFraction(500, 250, box)).toEqual({ x: 0.5, y: 0.5 });
    expect(toFraction(0, 1000, box)).toEqual({ x: 0, y: 1 });
  });

  it("rectangle tracé dans n'importe quel sens", () => {
    expect(rectFromPoints({ x: 0.6, y: 0.4 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, w: expect.closeTo(0.4), h: expect.closeTo(0.3) });
  });

  it("refuse un clic sans glissement", () => {
    expect(isUsable({ x: 0.3, y: 0.3, w: 0.001, h: 0.2 })).toBe(false);
    expect(isUsable({ x: 0.3, y: 0.3, w: 0.05, h: 0.02 })).toBe(true);
  });

  it("arrondi et style en pourcentages", () => {
    expect(round({ x: 0.123456789, y: 0, w: 0.5, h: 0.25 })).toEqual({ x: 0.12346, y: 0, w: 0.5, h: 0.25 });
    expect(toStyle({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toEqual({ left: "10%", top: "20%", width: "30%", height: "40%" });
  });
});
