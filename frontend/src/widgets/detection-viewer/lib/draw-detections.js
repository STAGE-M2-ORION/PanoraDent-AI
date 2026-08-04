import { detectionColor, detectionLabelText } from "@/entities/detection";
import { formatConfidence } from "@/shared/lib";

const BOX_LINE_WIDTH = 2;
const LABEL_FONT = "14px system-ui, sans-serif";
const LABEL_OFFSET = 4;
const LABEL_MIN_Y = 12;

function caption(detection) {
  return [
    detectionLabelText(detection.label),
    detection.fdi ? `#${detection.fdi}` : null,
    formatConfidence(detection.confidence),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Dessine l'image puis superpose les boîtes. Fonction pure au sens React :
 * aucun état, aucun accès au DOM hors du contexte fourni — testable seule.
 *
 * Le canvas est dimensionné à la taille native de l'image : les coordonnées
 * des détections sont en pixels de l'image analysée, aucune mise à l'échelle
 * n'est nécessaire (la réduction visuelle est faite en CSS).
 */
export function drawDetections(canvas, image, detections) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = image.width;
  canvas.height = image.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);

  ctx.lineWidth = BOX_LINE_WIDTH;
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "alphabetic";

  for (const detection of detections) {
    const color = detectionColor(detection.label);

    ctx.strokeStyle = color;
    ctx.strokeRect(detection.x, detection.y, detection.width, detection.height);

    ctx.fillStyle = color;
    ctx.fillText(
      caption(detection),
      detection.x,
      Math.max(LABEL_MIN_Y, detection.y - LABEL_OFFSET),
    );
  }
}
