/**
 * Géométrie de la radiographie panoramique SIMULÉE (dessin vectoriel, aucune
 * vraie image) — repris de `pano.js` (maquette).
 *
 * Repère : `viewBox="0 0 1200 600"`. Convention radiologique : la droite du
 * patient est à gauche de l'image.
 */
import { DetectionLabel } from "../model/detection";

export const PANO_W = 1200;
export const PANO_H = 600;
const MID = 600;
const GAP = 4;
const WIDTH = { 1: 42, 2: 40, 3: 44, 4: 46, 5: 48, 6: 62, 7: 62, 8: 60 };
const CROWN_UP = { 1: 70, 2: 64, 3: 76, 4: 64, 5: 62, 6: 58, 7: 56, 8: 54 };
const CROWN_LO = { 1: 56, 2: 56, 3: 70, 4: 62, 5: 60, 6: 56, 7: 54, 8: 52 };
const ROOT_UP = { 1: 110, 2: 100, 3: 140, 4: 112, 5: 110, 6: 96, 7: 92, 8: 80 };
const ROOT_LO = { 1: 104, 2: 108, 3: 132, 4: 118, 5: 120, 6: 108, 7: 102, 8: 72 };
const MISSING = new Set([18]);
const IMPACTED = { 38: { rot: -38, dx: 16, dy: 48 }, 48: { rot: 38, dx: -16, dy: 48 } };

/** Ce que « contient » l'image fictive (indépendant du statut des détections). */
export const PANO_LESIONS = [
  { fdi: 36, kind: DetectionLabel.DEEP_CARIES },
  { fdi: 36, kind: DetectionLabel.PERIAPICAL_LESION },
  { fdi: 46, kind: DetectionLabel.PERIAPICAL_LESION },
  { fdi: 26, kind: DetectionLabel.CARIES },
  { fdi: 17, kind: DetectionLabel.CARIES },
  { fdi: 24, kind: DetectionLabel.CARIES, faint: true },
  { fdi: 45, kind: DetectionLabel.CARIES, faint: true },
];

const occlusal = (x) => 300 + 22 * (1 - ((x - MID) / 460) ** 2);

function slotX(q, k) {
  let off = GAP / 2;
  for (let i = 1; i < k; i += 1) off += WIDTH[i] + GAP;
  off += WIDTH[k] / 2;
  return q === 1 || q === 4 ? MID - off : MID + off;
}

function buildTeeth() {
  const teeth = {};
  [1, 2, 3, 4].forEach((q) => {
    for (let k = 1; k <= 8; k += 1) {
      const fdi = q * 10 + k;
      if (MISSING.has(fdi)) continue;
      const upper = q <= 2;
      let cx = slotX(q, k);
      const w = WIDTH[k];
      const ch = upper ? CROWN_UP[k] : CROWN_LO[k];
      const rl = upper ? ROOT_UP[k] : ROOT_LO[k];
      let y0 = upper ? occlusal(cx) - 6 : occlusal(cx) + 6;
      const imp = IMPACTED[fdi];
      const t = { fdi, q, k, upper, cx, w, ch, rl, y0, dir: upper ? -1 : 1, impacted: Boolean(imp), rot: 0 };
      if (imp) {
        t.cx = cx += imp.dx;
        t.y0 = y0 += imp.dy;
        t.rot = imp.rot;
        const hh = ch + rl;
        const th = (Math.abs(imp.rot) * Math.PI) / 180;
        const bw = w * Math.cos(th) + hh * Math.sin(th);
        const bh = w * Math.sin(th) + hh * Math.cos(th);
        const ccy = y0 + hh / 2;
        t.box = { x: cx - bw / 2, y: ccy - bh / 2, w: bw, h: bh };
        t.crown = { x: cx - bw / 2, y: ccy - bh / 2, w: bw, h: bh * 0.45 };
        t.apex = { x: cx, y: ccy + bh / 2 - 10 };
      } else {
        const total = ch + rl + 6;
        t.box = upper ? { x: cx - w / 2 - 3, y: y0 - total, w: w + 6, h: total + 2 } : { x: cx - w / 2 - 3, y: y0 - 2, w: w + 6, h: total + 2 };
        t.crown = upper ? { x: cx - w / 2, y: y0 - ch, w, h: ch } : { x: cx - w / 2, y: y0, w, h: ch };
        t.apex = upper ? { x: cx, y: y0 - ch - rl } : { x: cx, y: y0 + ch + rl };
      }
      teeth[fdi] = t;
    }
  });
  return teeth;
}

/** Géométrie de chaque dent de l'image fictive, indexée par numéro FDI. */
export const PANO_TEETH = buildTeeth();

/** Cadre d'une détection (en coordonnées de l'image) pour une dent et une classe. */
export function panoBoxFor(fdi, label) {
  const t = PANO_TEETH[fdi];
  if (!t) return null;
  const c = t.crown;
  if (label === DetectionLabel.CARIES) {
    const h = c.h * 0.48;
    const w = c.w * 0.62;
    return t.upper ? { x: t.cx - w / 2 + 4, y: c.y + c.h - h - 2, w, h } : { x: t.cx - w / 2 + 4, y: c.y + 2, w, h };
  }
  if (label === DetectionLabel.DEEP_CARIES) {
    const h = c.h * 0.92;
    const w = c.w * 0.84;
    return t.upper ? { x: t.cx - w / 2, y: c.y + c.h - h, w, h } : { x: t.cx - w / 2, y: c.y, w, h };
  }
  if (label === DetectionLabel.PERIAPICAL_LESION) {
    const s = 58;
    const ax = t.apex.x - (t.k >= 6 ? 12 : 0);
    return { x: ax - s / 2, y: t.apex.y - s / 2, w: s, h: s };
  }
  return { ...t.box };
}

export function toothPath(w, ch) {
  const l = -w / 2;
  const r = w / 2;
  return `M ${l + 3} ${ch} L ${l + 1} 16 Q ${l + 1} 2 ${l + 13} 2 L ${r - 13} 2 Q ${r - 1} 2 ${r - 1} 16 L ${r - 3} ${ch} Z`;
}

export function rootPaths(k, w, ch, rl) {
  if (k >= 6) {
    const a = w * 0.28;
    return [
      `M ${-w / 2 + 4} ${ch - 4} Q ${-w / 2 + 2} ${ch + rl * 0.55} ${-a - 4} ${ch + rl} Q ${-a} ${ch + rl + 6} ${-a + 5} ${ch + rl - 2} Q ${-3} ${ch + rl * 0.5} ${-2} ${ch - 4} Z`,
      `M ${2} ${ch - 4} Q ${3} ${ch + rl * 0.5} ${a - 5} ${ch + rl - 2} Q ${a} ${ch + rl + 6} ${a + 4} ${ch + rl} Q ${w / 2 - 2} ${ch + rl * 0.55} ${w / 2 - 4} ${ch - 4} Z`,
    ];
  }
  const rw = w * 0.62;
  return [`M ${-rw / 2} ${ch - 4} Q ${-rw / 2 + 2} ${ch + rl * 0.6} ${-3} ${ch + rl} Q 0 ${ch + rl + 7} 3 ${ch + rl} Q ${rw / 2 - 2} ${ch + rl * 0.6} ${rw / 2} ${ch - 4} Z`];
}
