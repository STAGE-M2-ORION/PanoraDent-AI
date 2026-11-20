/**
 * Géométrie de la visionneuse. L'image (W pixels de large) est affichée sur
 * `base` pixels d'écran, puis translatée (`tx`, `ty`) et agrandie (`zoom`) :
 * écran = t + image × (base / W) × zoom. Les cadres sont dessinés dans le
 * repère de l'image (SVG `viewBox`), donc subissent la même transformation
 * que l'image : ils restent alignés quel que soit le zoom.
 */

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 8;

/** Point de l'image → point de l'écran (relatif à la scène). */
export function imageToScreen(p, view, W) {
  const k = (view.base / W) * view.zoom;
  return { x: view.tx + p.x * k, y: view.ty + p.y * k };
}

/** Point de l'écran (relatif à la scène) → point de l'image. */
export function screenToImage(p, view, W) {
  const k = (view.base / W) * view.zoom;
  return { x: (p.x - view.tx) / k, y: (p.y - view.ty) / k };
}

/** Cadre de l'image → rectangle à l'écran. */
export function boxToScreen(box, view, W) {
  const a = imageToScreen({ x: box.x, y: box.y }, view, W);
  const k = (view.base / W) * view.zoom;
  return { x: a.x, y: a.y, w: box.w * k, h: box.h * k };
}

/** Zoom de `factor` autour du point d'écran (x, y), qui reste immobile. */
export function zoomAround(view, factor, x, y) {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom * factor));
  const r = zoom / view.zoom;
  return { ...view, zoom, tx: x - (x - view.tx) * r, ty: y - (y - view.ty) * r };
}
