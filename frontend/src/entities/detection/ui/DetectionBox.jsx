import { detectionType } from "../model/detection";

/**
 * Cadre d'une détection dans le repère de l'image : rectangle teinté, équerres
 * cyan (motif signature) et étiquette « dent · confiance ». Trait plein pour
 * une proposition du modèle, pointillé pour un ajout ou une correction.
 *
 * `box = { x, y, w, h }` ; `scale` ajuste épaisseurs et étiquette à la taille
 * réelle de l'image (1 pour le repère 1200 × 600 de l'image simulée).
 */
export function DetectionBox({ box, label, fdi, confidence, dashed, scale = 1, imageWidth = 1200, corners = true, selected, opacity }) {
  const color = detectionType(label).color;
  const { x, y, w, h } = box;
  const cl = Math.min(w, h) * 0.32;
  const text = `${fdi ?? "?"} · ${confidence == null ? "ajoutée" : `${confidence} %`}`;
  const fs = 19 * scale;
  const tw = text.length * fs * 0.62 + 24 * scale;
  const lx = Math.min(x, imageWidth - 2 * scale - tw);
  const ly = Math.max(2 * scale, y - fs * 1.6 - 3 * scale);
  return (
    <g opacity={opacity}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6 * scale}
        fill={color}
        fillOpacity={selected ? 0.14 : 0.06}
        stroke={color}
        strokeWidth={(selected ? 3 : 1.6) * scale}
        strokeDasharray={dashed ? `${8 * scale} ${6 * scale}` : "none"}
      />
      {corners ? (
        <path
          d={`M${x - 2} ${y + cl} V${y - 2} H${x + cl} M${x + w - cl} ${y - 2} H${x + w + 2} V${y + cl} M${x + w + 2} ${y + h - cl} V${y + h + 2} H${x + w - cl} M${x + cl} ${y + h + 2} H${x - 2} V${y + h - cl}`}
          fill="none"
          stroke="#22D3EE"
          strokeWidth={4 * scale}
          strokeLinecap="square"
        />
      ) : null}
      <rect x={lx} y={ly} width={tw} height={fs * 1.55} rx={8 * scale} fill="#0E7490" />
      <text x={lx + 10 * scale} y={ly + fs * 1.1} fill="#FFFFFF" fontSize={fs} fontFamily="JetBrains Mono, monospace" fontWeight="500">
        {text}
      </text>
    </g>
  );
}
