/**
 * Géométrie des masques, en fractions de l'image (x, y, w, h dans [0, 1]) :
 * indépendante de la taille d'affichage de l'aperçu, comme côté serveur.
 */

/** Plus petit masque accepté (en fraction) : évite les clics accidentels. */
export const MIN_SIZE = 0.005;
export const MAX_MASKS = 50;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Position d'un pointeur dans un élément → fraction de l'image. */
export function toFraction(clientX, clientY, rect) {
  return { x: clamp01((clientX - rect.left) / rect.width), y: clamp01((clientY - rect.top) / rect.height) };
}

/** Rectangle normalisé entre deux points (dans n'importe quel sens). */
export function rectFromPoints(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function isUsable(rect) {
  return rect.w >= MIN_SIZE && rect.h >= MIN_SIZE;
}

/** Arrondi à 5 décimales (taille du JSON, comme le serveur). */
export function round(rect) {
  const r = (v) => Math.round(v * 1e5) / 1e5;
  return { x: r(rect.x), y: r(rect.y), w: r(rect.w), h: r(rect.h) };
}

/** Rectangle → style CSS en pourcentages, superposé à l'image. */
export function toStyle(rect) {
  return { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` };
}
