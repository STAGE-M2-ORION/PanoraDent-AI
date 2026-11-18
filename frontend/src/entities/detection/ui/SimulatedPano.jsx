import { useId } from "react";

import { panoBoxFor, PANO_H, PANO_LESIONS, PANO_TEETH, PANO_W, rootPaths, toothPath } from "../lib/pano-geometry";
import { DetectionLabel } from "../model/detection";

const TEETH = Object.values(PANO_TEETH);

/**
 * Radiographie panoramique SIMULÉE (dessin vectoriel, aucune vraie image) :
 * illustration de la vitrine et repli de démonstration de la visionneuse.
 * Rend un groupe `<g>` à placer dans un `<svg viewBox="0 0 1200 600">`.
 */
export function SimulatedPanoImage({ watermark = true }) {
  const uid = useId().replace(/:/g, "");
  const u = (name) => `url(#${uid}${name})`;
  const label = { fill: "#AAB4BC", fontFamily: "Satoshi, sans-serif", fontSize: 18, fontWeight: 600 };

  return (
    <g className="pano-image">
      <defs>
        <radialGradient id={`${uid}bone`} cx="50%" cy="60%" r="60%">
          <stop offset="0" stopColor="#5a636b" />
          <stop offset=".55" stopColor="#3b4249" />
          <stop offset="1" stopColor="#1b1f23" />
        </radialGradient>
        <linearGradient id={`${uid}dentin`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d7dde1" />
          <stop offset=".35" stopColor="#b5bec4" />
          <stop offset="1" stopColor="#7f8990" />
        </linearGradient>
        <linearGradient id={`${uid}root`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a8b1b8" />
          <stop offset="1" stopColor="#6d767d" />
        </linearGradient>
        <filter id={`${uid}soft`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
        <filter id={`${uid}blur`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
        <filter id={`${uid}blur8`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id={`${uid}grain`}>
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" />
          <feColorMatrix values="0 0 0 0 .6  0 0 0 0 .6  0 0 0 0 .6  0 0 0 .22 0" />
        </filter>
      </defs>
      <rect x="0" y="0" width={PANO_W} height={PANO_H} fill="#111417" />
      {/* Os : maxillaire, mandibule, branches montantes (formes floues) */}
      <g filter={u("blur")}>
        <path d="M 70 560 C 120 420 150 330 210 300 C 400 380 800 380 990 300 C 1050 330 1080 420 1130 560 Z" fill={u("bone")} />
        <path d="M 60 130 C 70 260 90 330 120 560 L 210 560 C 190 420 180 300 170 140 Z" fill="#3e454c" />
        <path d="M 1140 130 C 1130 260 1110 330 1080 560 L 990 560 C 1010 420 1020 300 1030 140 Z" fill="#3e454c" />
        <path d="M 170 300 C 300 120 900 120 1030 300 C 900 250 300 250 170 300 Z" fill="#4d555c" />
        <ellipse cx="600" cy="470" rx="380" ry="60" fill="#555e66" opacity=".6" />
      </g>
      {/* Sinus maxillaires et fosses nasales (zones sombres) */}
      <g filter={u("blur8")}>
        <ellipse cx="395" cy="120" rx="125" ry="52" fill="#1d2125" opacity=".9" />
        <ellipse cx="805" cy="120" rx="125" ry="52" fill="#1d2125" opacity=".9" />
        <path d="M 520 20 C 540 90 660 90 680 20 Z" fill="#16191c" />
        <path d="M 230 165 C 400 128 800 128 970 165" stroke="#6c757d" strokeWidth="7" fill="none" opacity=".7" />
      </g>
      {/* Ombres de la colonne cervicale (fantômes latéraux) */}
      <g filter={u("blur")} opacity=".45">
        <rect x="0" y="60" width="50" height="520" fill="#6b737a" />
        <rect x="1150" y="60" width="50" height="520" fill="#6b737a" />
      </g>
      {/* Canal mandibulaire */}
      <path d="M 150 380 C 260 470 420 505 600 512 C 780 505 940 470 1050 380" stroke="#2a3035" strokeWidth="10" fill="none" opacity=".55" filter={u("blur8")} />

      {/* Dents */}
      <g filter={u("soft")}>
        {TEETH.map((t) => {
          const transform = t.impacted
            ? `translate(${t.cx} ${t.y0}) rotate(${t.rot} 0 ${(t.ch + t.rl) / 2}) scale(1 ${t.dir})`
            : `translate(${t.cx} ${t.y0}) scale(1 ${t.dir})`;
          return (
            <g key={t.fdi} transform={transform}>
              {rootPaths(t.k, t.w, t.ch, t.rl).map((d) => (
                <path key={d} d={d} fill={u("root")} />
              ))}
              <path d={toothPath(t.w, t.ch)} fill={u("dentin")} />
              <path
                d={`M ${-t.w / 2 + 2} 18 Q ${-t.w / 2 + 2} 3 ${-t.w / 2 + 13} 3 L ${t.w / 2 - 13} 3 Q ${t.w / 2 - 2} 3 ${t.w / 2 - 2} 18 L ${t.w / 2 - 4} 24 L ${-t.w / 2 + 4} 24 Z`}
                fill="#eef1f3"
                opacity=".85"
              />
              {/* Chambre pulpaire et canaux (radio-clairs, donc sombres) */}
              <path
                d={`M ${-t.w * 0.2} ${t.ch * 0.45} Q 0 ${t.ch * 0.32} ${t.w * 0.2} ${t.ch * 0.45} L ${t.w * 0.12} ${t.ch + 4} L ${-t.w * 0.12} ${t.ch + 4} Z`}
                fill="#5b646b"
                opacity=".8"
              />
              {t.k >= 6 ? (
                <>
                  <path d={`M ${-t.w * 0.1} ${t.ch} L ${-t.w * 0.26} ${t.ch + t.rl - 6}`} stroke="#5b646b" strokeWidth="2.5" fill="none" />
                  <path d={`M ${t.w * 0.1} ${t.ch} L ${t.w * 0.26} ${t.ch + t.rl - 6}`} stroke="#5b646b" strokeWidth="2.5" fill="none" />
                </>
              ) : (
                <path d={`M 0 ${t.ch} L 0 ${t.ch + t.rl - 6}`} stroke="#5b646b" strokeWidth="2.5" fill="none" />
              )}
            </g>
          );
        })}
      </g>

      {/* Anomalies visibles sur l'image fictive */}
      <g>
        {PANO_LESIONS.map((l) => {
          const t = PANO_TEETH[l.fdi];
          if (!t) return null;
          const key = `${l.fdi}-${l.kind}`;
          if (l.kind === DetectionLabel.PERIAPICAL_LESION) {
            const ax = t.apex.x - (t.k >= 6 ? 12 : 0);
            return <ellipse key={key} cx={ax} cy={t.apex.y + (t.upper ? -4 : 4)} rx="19" ry="16" fill="#1a1e22" opacity=".85" filter={u("blur8")} />;
          }
          const b = panoBoxFor(l.fdi, l.kind);
          const deep = l.kind === DetectionLabel.DEEP_CARIES;
          return (
            <ellipse
              key={key}
              cx={b.x + b.w / 2}
              cy={b.y + b.h / 2}
              rx={deep ? b.w * 0.34 : b.w * 0.26}
              ry={deep ? b.h * 0.36 : b.h * 0.3}
              fill="#23292e"
              opacity={l.faint ? 0.5 : 0.82}
              filter={u("soft")}
            />
          );
        })}
      </g>

      {/* Grain de film */}
      <rect x="0" y="0" width={PANO_W} height={PANO_H} filter={u("grain")} opacity=".5" />
      {/* Repères latéraux et mention « image simulée » */}
      <text {...label} x="24" y="40">
        D
      </text>
      <text {...label} x="1162" y="40">
        G
      </text>
      {watermark ? (
        <text x="1176" y="584" textAnchor="end" fill="#AAB4BC" fontFamily="Satoshi, sans-serif" fontSize="15" letterSpacing="1">
          IMAGE SIMULÉE — FICTIVE, NON CLINIQUE
        </text>
      ) : null}
    </g>
  );
}
