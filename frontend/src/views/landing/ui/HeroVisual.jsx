import { HERO_DETECTIONS } from "../lib/landing-content";

/**
 * Arcade stylisée : deux arcs elliptiques de dents, purement décoratifs.
 * Les coordonnées sont des attributs SVG, pas du style inline — la règle
 * « aucun style inline » vise la mise en forme CSS, pas la géométrie.
 */
const TOOTH_COUNT = 14;
const ARCHES = [
  { id: "maxillaire", cy: 78, ry: 46, direction: 1 },
  { id: "mandibule", cy: 104, ry: 40, direction: -1 },
];

function archTeeth({ cy, ry, direction }) {
  return Array.from({ length: TOOTH_COUNT }, (_, index) => {
    const angle = Math.PI * (0.08 + (index / (TOOTH_COUNT - 1)) * 0.84);
    const rotation = (Math.atan2(-Math.cos(angle), direction * Math.sin(angle)) * 180) / Math.PI;

    return {
      key: index,
      x: 160 - Math.cos(angle) * 130,
      y: cy - direction * Math.sin(angle) * ry,
      rotation,
    };
  });
}

/** Résolution `tone` → classes littérales : Tailwind ne voit pas `border-${tone}`. */
const BOX_TONE = {
  normal: "border-detection-normal",
  anomaly: "border-detection-anomaly",
};

const LABEL_TONE = {
  normal: "bg-detection-normal text-background",
  anomaly: "bg-detection-anomaly text-background",
};

export function HeroVisual() {
  return (
    <div
      data-reveal="frame"
      aria-hidden="true"
      className="relative aspect-[16/9] overflow-hidden rounded-xl border border-border bg-foreground shadow-xl"
    >
      <svg
        viewBox="0 0 320 180"
        className="absolute inset-0 size-full text-background/20"
        role="presentation"
      >
        {ARCHES.map((arch) => (
          <g key={arch.id}>
            {archTeeth(arch).map((tooth) => (
              <rect
                key={tooth.key}
                x="-6"
                y="-9"
                width="12"
                height="18"
                rx="4"
                fill="currentColor"
                transform={`translate(${tooth.x} ${tooth.y}) rotate(${tooth.rotation})`}
              />
            ))}
          </g>
        ))}
      </svg>

      {/* Balayage : animé par `useLandingReveal`, immobile sans JavaScript. */}
      <div data-reveal="scan" className="absolute inset-y-0 left-0 w-px bg-detection-normal" />

      {HERO_DETECTIONS.map((detection) => (
        <div
          key={detection.id}
          data-reveal="box"
          className={`absolute rounded-sm border-2 ${BOX_TONE[detection.tone]} ${detection.className}`}
        >
          <span
            className={`absolute -top-5 left-0 rounded-sm px-1.5 py-px text-[10px] font-medium whitespace-nowrap ${LABEL_TONE[detection.tone]}`}
          >
            {detection.label}
          </span>
        </div>
      ))}
    </div>
  );
}
