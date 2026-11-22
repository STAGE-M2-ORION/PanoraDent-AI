import { detectionType } from "@/entities/detection";

import { isDashed, pct } from "../model/view-model";

/**
 * Formes à dessiner sur l'export : ce que montre la visionneuse (calques
 * affichés, seuil de confiance appliqué), sans les rejets, en pixels de l'image.
 * Fonction pure, testée sans navigateur.
 */
export function buildAnnotations(vm, dets, { visible, show }) {
  const shapes = [];
  if (show.tooth) {
    vm.teeth.forEach((t) => shapes.push({ kind: "tooth", box: t.box, color: "#56B4E9", dashed: false, text: String(t.fdi), upper: t.upper }));
  }
  // Les détections rejetées (fausses alertes) ne figurent pas sur l'export.
  dets.filter((d) => visible(d) && d.status !== "rejected").forEach((d) => {
    const type = detectionType(d.label);
    shapes.push({
      kind: "detection",
      box: d.box,
      color: type.color,
      dashed: isDashed(d),
      text: `${d.fdi ?? "?"} · ${d.confidence == null ? "ajoutée" : pct(d.confidence)} · ${type.short}`,
    });
  });
  return shapes;
}

/** Nom du fichier exporté : référence anonyme seule, aucune donnée patient. */
export const exportFileName = (vm) => `panoradent-${String(vm.ref || "demo").replace(/[^a-z0-9-]+/gi, "-")}-annotee.png`;

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    // Servie par /storage/ (même origine) : le canevas reste exportable.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image indisponible : export impossible."));
    img.src = src;
  });

/**
 * Image annotée en PNG, à la résolution de la version d'affichage.
 * `source` : URL de l'image, ou élément <svg> (démonstration) rasterisé.
 * Un bandeau indique la référence, le modèle et le statut d'aide à la lecture.
 */
export async function renderAnnotatedPng(vm, shapes, { source, filter = "none" }) {
  let src = source;
  let revoke = null;
  if (source && typeof source !== "string") {
    const xml = new XMLSerializer().serializeToString(source);
    src = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
    revoke = src;
  }
  const W = vm.width;
  const H = vm.height;
  const u = W / 1200;
  const band = Math.round(34 * u);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H + band;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111417";
  ctx.fillRect(0, 0, W, H + band);
  try {
    if (src) {
      const img = await loadImage(src);
      ctx.filter = filter;
      ctx.drawImage(img, 0, 0, W, H);
      ctx.filter = "none";
    }
  } finally {
    if (revoke) URL.revokeObjectURL(revoke);
  }

  const fs = 17 * u;
  ctx.font = `500 ${fs}px "JetBrains Mono", monospace`;
  ctx.textBaseline = "middle";
  // Étiquettes : même évitement des chevauchements que la visionneuse.
  const placed = [];
  const overlaps = (x, y, w, h) => placed.some((q) => x < q.x + q.w && x + w > q.x && y < q.y + q.h && y + h > q.y);
  shapes.forEach((s) => {
    const b = s.box;
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = (s.kind === "tooth" ? 1.2 : 2) * u;
    ctx.globalAlpha = s.kind === "tooth" ? 0.6 : 1;
    ctx.setLineDash(s.dashed ? [7 * u, 5 * u] : []);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    if (s.kind === "tooth") {
      ctx.fillStyle = s.color;
      ctx.textAlign = "center";
      ctx.fillText(s.text, b.x + b.w / 2, s.upper ? b.y - fs * 0.7 : b.y + b.h + fs * 0.7);
    } else {
      const tw = ctx.measureText(s.text).width + fs * 1.6;
      const th = fs * 1.55;
      let ly = b.y - th - 3 * u;
      if (ly < 2 * u) ly = b.y + b.h + 3 * u;
      const lx = Math.min(b.x, W - 2 * u - tw);
      if (overlaps(lx, ly, tw, th) && !overlaps(lx, b.y + b.h + 3 * u, tw, th)) ly = b.y + b.h + 3 * u;
      for (let guard = 0; overlaps(lx, ly, tw, th) && guard < 8; guard += 1) ly += th + 2 * u;
      placed.push({ x: lx, y: ly, w: tw, h: th });
      ctx.fillStyle = "#0E7490";
      ctx.fillRect(lx, ly, tw, th);
      ctx.fillStyle = s.color;
      ctx.fillRect(lx + fs * 0.4, ly + th / 2 - fs * 0.3, fs * 0.6, fs * 0.6);
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "left";
      ctx.fillText(s.text, lx + fs * 1.25, ly + th / 2);
    }
    ctx.restore();
  });

  ctx.fillStyle = "#0B1220";
  ctx.fillRect(0, H, W, band);
  ctx.fillStyle = "#E2E8F0";
  ctx.font = `${14 * u}px "Inter", sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(
    `PanoraDent AI · référence ${vm.ref || "démonstration"} · modèle ${vm.modelVersion || "—"} · aide à la lecture, ne remplace pas le diagnostic du praticien`,
    10 * u,
    H + band / 2,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Export impossible."))), "image/png");
  });
}

/** Déclenche le téléchargement d'un Blob. */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
