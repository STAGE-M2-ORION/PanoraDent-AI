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

/* ---------- Édition des cadres (pixels de l'image), toujours dans l'image ---------- */

/** Déplace un cadre sans le faire sortir de l'image (W × H). */
export function moveBox(b, dx, dy, W, H) {
  return { ...b, x: Math.min(Math.max(b.x + dx, 0), W - b.w), y: Math.min(Math.max(b.y + dy, 0), H - b.h) };
}

/**
 * Redimensionne par un coin (`tl`, `tr`, `bl`, `br`) : le coin opposé reste
 * fixe, le coin tiré est borné à l'image et le cadre garde `min` de côté.
 */
export function resizeBox(b, corner, dx, dy, W, H, min) {
  let x0 = b.x;
  let y0 = b.y;
  let x1 = b.x + b.w;
  let y1 = b.y + b.h;
  if (corner.includes("l")) x0 = Math.min(Math.max(x0 + dx, 0), x1 - min);
  else x1 = Math.max(Math.min(x1 + dx, W), x0 + min);
  if (corner.includes("t")) y0 = Math.min(Math.max(y0 + dy, 0), y1 - min);
  else y1 = Math.max(Math.min(y1 + dy, H), y0 + min);
  return { ...b, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Cadre tracé entre deux points, borné à l'image. */
export function boxFromPoints(a, b, W, H) {
  const cx = (v) => Math.min(Math.max(v, 0), W);
  const cy = (v) => Math.min(Math.max(v, 0), H);
  const x0 = cx(Math.min(a.x, b.x));
  const y0 = cy(Math.min(a.y, b.y));
  return { x: x0, y: y0, w: cx(Math.max(a.x, b.x)) - x0, h: cy(Math.max(a.y, b.y)) - y0 };
}
