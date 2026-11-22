/**
 * Odontogramme (sprint 7) : logique pure, sans DOM — testée par vitest.
 *
 * Le schéma est dessiné en SVG à partir d'une table de positions FIXE : il
 * reste lisible à petite taille, s'imprime sans perte, et ne dépend pas de la
 * géométrie du cliché. Chaque dent est un élément focalisable, dont le numéro
 * et l'état sont annoncés aux lecteurs d'écran.
 */

import { ANOMALY_LABELS, detectionType, markPath } from "@/entities/detection";

/** Ordre d'affichage, face au patient : sa droite à gauche du schéma. */
export const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

const PAS = 40; // largeur d'une colonne, en unités du viewBox
export const VIEWBOX = { width: UPPER.length * PAS, height: 176 };

/** Famille de dent selon son rang : sert au dessin (racines, largeur). */
export function toothKind(fdi) {
  const rang = fdi % 10;
  if (rang >= 6) return "molaire";
  if (rang >= 4) return "prémolaire";
  if (rang === 3) return "canine";
  return "incisive";
}

/** Position fixe de chaque dent : colonne, arcade, centre. */
export const POSITIONS = Object.fromEntries(
  [UPPER, LOWER].flatMap((arcade, ligne) =>
    arcade.map((fdi, col) => [fdi, { fdi, col, upper: ligne === 0, cx: col * PAS + PAS / 2, cy: ligne === 0 ? 44 : 132 }]),
  ),
);

export const ToothState = {
  PRESENT: "present", // détectée, sans anomalie
  ANOMALY: "anomaly", // détectée, porteuse d'au moins une anomalie retenue
  ABSENT: "absent", // déclarée absente par le praticien
  UNDETECTED: "undetected", // ni détectée, ni déclarée : à vérifier sur le cliché
};

const STATE_TEXT = {
  [ToothState.PRESENT]: "présente, aucune anomalie proposée",
  [ToothState.ANOMALY]: "présente",
  [ToothState.ABSENT]: "déclarée absente",
  [ToothState.UNDETECTED]: "non détectée",
};

/**
 * État de chaque dent du schéma.
 *
 * `teeth` : détections de dents de la vue (rejetées exclues) ; `dets` :
 * anomalies (une anomalie rejetée ne marque plus la dent) ; `absentTeeth` :
 * numéros déclarés absents ; `incoherences` : signalements du serveur.
 */
export function toothStates({ teeth = [], dets = [], absentTeeth = [], incoherences = [] }) {
  const absent = new Set(absentTeeth.map((a) => (typeof a === "number" ? a : a.fdi)));
  const signale = new Map();
  incoherences.forEach((i) => (i.fdi ?? []).forEach((f) => signale.set(f, [...(signale.get(f) ?? []), i])));
  return Object.fromEntries(
    [...UPPER, ...LOWER].map((fdi) => {
      const detections = teeth.filter((t) => t.fdi === fdi);
      const anomalies = dets.filter((d) => d.fdi === fdi && d.status !== "rejected");
      let state = ToothState.UNDETECTED;
      if (detections.length) state = anomalies.length ? ToothState.ANOMALY : ToothState.PRESENT;
      else if (absent.has(fdi)) state = ToothState.ABSENT;
      const issues = signale.get(fdi) ?? [];
      return [
        fdi,
        {
          fdi,
          state,
          detections,
          anomalies,
          doubtful: issues.length > 0 || detections.some((t) => t.doubtful),
          issues,
          reviewed: anomalies.length > 0 && anomalies.every((d) => d.status !== "pending"),
        },
      ];
    }),
  );
}

/** Libellé annoncé par un lecteur d'écran, et infobulle. */
export function toothLabel(s, typeText = (label) => label) {
  const parts = [`Dent ${s.fdi}`, STATE_TEXT[s.state]];
  if (s.state === ToothState.ANOMALY) {
    const pending = s.anomalies.filter((d) => d.status === "pending").length;
    parts.push(s.anomalies.map((d) => typeText(d.label)).join(", "));
    if (pending) parts.push(`${pending} à revoir`);
  }
  if (s.detections.length > 1) parts.push(`${s.detections.length} détections portent ce numéro`);
  if (s.doubtful) parts.push("numéro à vérifier");
  return parts.join(" · ");
}

/**
 * Navigation au clavier dans le schéma : ← → le long de l'arcade, ↑ ↓ d'une
 * arcade à l'autre, Début / Fin aux extrémités. Renvoie le numéro visé, ou
 * `null` si la touche n'est pas une touche de navigation.
 */
export function nextTooth(fdi, key) {
  const { col, upper } = POSITIONS[fdi];
  const row = upper ? UPPER : LOWER;
  const other = upper ? LOWER : UPPER;
  switch (key) {
    case "ArrowLeft":
      return row[Math.max(0, col - 1)];
    case "ArrowRight":
      return row[Math.min(row.length - 1, col + 1)];
    case "ArrowUp":
    case "ArrowDown":
      return other[col];
    case "Home":
      return row[0];
    case "End":
      return row[row.length - 1];
    default:
      return null;
  }
}

/** Couleurs de l'export (indépendantes du thème de l'écran). */
const EXPORT = {
  fond: "#0F172A",
  texte: "#E2E8F0",
  attenue: "#475569",
  doute: "#F59E0B",
  dent: "#56B4E9",
};

/**
 * Schéma autonome en SVG (styles en ligne), pour l'export en image : il ne
 * dépend ni du thème ni des feuilles de style de la page.
 */
export function toSvgString(states, { title = "Schéma dentaire (FDI)" } = {}) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const h = VIEWBOX.height + 28;
  const marque = (label, cx, cy, r) => `<path d="${markPath(label, cx, cy, r)}" fill="${detectionType(label).color}" stroke="#0B1220" stroke-width="0.8"/>`;
  // Légende des marques : forme, abréviation et nom, lisible imprimée en gris.
  const legende = ANOMALY_LABELS.map((label, i) => {
    const x = 8 + i * 150;
    return `${marque(label, x + 4, h + 8, 4)}<text x="${x + 12}" y="${h + 12}" font-family="sans-serif" font-size="10" fill="${EXPORT.texte}">${esc(`${detectionType(label).abbr} = ${detectionType(label).label}`)}</text>`;
  }).join("");
  const hTotal = h + 20;
  const dents = Object.values(states)
    .map((s) => {
      const p = POSITIONS[s.fdi];
      const top = p.upper ? 26 : 112;
      const couleur = s.state === ToothState.ABSENT || s.state === ToothState.UNDETECTED ? EXPORT.attenue : EXPORT.dent;
      const trait = s.doubtful ? EXPORT.doute : couleur;
      const pointille = s.state === ToothState.ABSENT ? ' stroke-dasharray="3 2"' : "";
      const marques = s.anomalies
        .slice(0, 3)
        .map((d, i) => marque(d.label, p.cx - 8 + i * 8, p.upper ? top + 46 : top - 6, 3))
        .join("");
      return (
        `<g><rect x="${p.cx - 14}" y="${top}" width="28" height="38" rx="5" fill="none" stroke="${trait}" stroke-width="${s.doubtful ? 2.5 : 1.5}"${pointille}/>` +
        `<text x="${p.cx}" y="${top + 24}" text-anchor="middle" font-family="monospace" font-size="11" fill="${couleur}">${s.fdi}</text>` +
        `${s.state === ToothState.ABSENT ? `<line x1="${p.cx - 10}" y1="${top + 4}" x2="${p.cx + 10}" y2="${top + 34}" stroke="${EXPORT.attenue}"/>` : ""}${marques}</g>`
      );
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEWBOX.width * 2}" height="${hTotal * 2}" viewBox="0 0 ${VIEWBOX.width} ${hTotal}">` +
    `<rect width="100%" height="100%" fill="${EXPORT.fond}"/>` +
    `<text x="8" y="14" font-family="sans-serif" font-size="11" fill="${EXPORT.texte}">${esc(title)}</text>` +
    `<line x1="${VIEWBOX.width / 2}" y1="20" x2="${VIEWBOX.width / 2}" y2="${h - 4}" stroke="${EXPORT.attenue}" stroke-dasharray="2 3"/>` +
    `<g transform="translate(0 8)">${dents}</g>${legende}</svg>`
  );
}

/** Nom du fichier exporté : la seule référence anonyme. */
export function odontogramFileName(ref) {
  return `odontogramme-${String(ref || "analyse").replace(/[^A-Za-z0-9-]/g, "_")}.png`;
}
