import { Processing, formatAnalysisNumber } from "@/entities/analysis";
import { DetectionLabel, PANO_H, PANO_TEETH, PANO_W, panoBoxFor } from "@/entities/detection";
import { demoAnalysis, demoDetections } from "@/shared/demo";
import { formatDate, formatTime } from "@/shared/lib";

/**
 * Forme commune à l'analyse réelle et à la démonstration, consommée par la
 * visionneuse, la liste et l'odontogramme. Toutes les coordonnées sont en
 * pixels de l'image (`width` × `height`).
 *
 * `{ id, demo, number, ref, date, time, modelVersion, width, height, imageUrl,
 *    closed, teeth: [{ fdi, box, cx, upper }], dets: [{ id, fdi, label,
 *    confidence, status, source, note, was, box }] }`
 */

/** Analyse de démonstration : image simulée et détections de la maquette. */
export function demoViewModel() {
  const dets = demoDetections.map((d) => ({ ...d, box: panoBoxFor(d.fdi, d.label) }));
  // La correction de la 17 a légèrement réduit son cadre.
  const d6 = dets.find((d) => d.id === "d6");
  d6.box = { ...d6.box, h: d6.box.h * 0.8, y: d6.box.y + d6.box.h * 0.2 };
  const now = new Date();
  return {
    id: null,
    demo: true,
    number: demoAnalysis.number,
    ref: demoAnalysis.patientId,
    date: formatDate(now),
    time: "09:14",
    modelVersion: demoAnalysis.model,
    modelShort: demoAnalysis.modelShort,
    processing: Processing.DONE,
    error: "",
    durationMs: null,
    width: PANO_W,
    height: PANO_H,
    imageUrl: null,
    closed: false,
    closedAt: null,
    closedBy: null,
    conclusion: "",
    api: null, // démonstration : relecture locale, rien n'est envoyé
    teeth: Object.values(PANO_TEETH).map((t) => ({ id: `demo-${t.fdi}`, fdi: t.fdi, box: t.box, cx: t.cx, upper: t.upper, status: "pending", doubtful: false, rank: null, proposalFdi: t.fdi })),
    dets,
    incoherences: [],
    absentTeeth: [],
  };
}

/**
 * Détection (entité) → forme de la vue. `note` : commentaire du verdict
 * courant ; `proposal` : valeurs d'origine (cadre en pixels) ; `was` : type
 * proposé quand le praticien l'a corrigé.
 */
export function toViewDetection(d) {
  const proposal = d.proposal ? { label: d.proposal.label, fdi: d.proposal.fdi, box: { x: d.proposal.x, y: d.proposal.y, w: d.proposal.width, h: d.proposal.height } } : null;
  return {
    id: d.id,
    fdi: d.fdi,
    label: d.label,
    confidence: d.confidence,
    status: d.status,
    source: d.source,
    note: d.comment ?? "",
    reviewedBy: d.reviewedBy ?? null,
    reviewedAt: d.reviewedAt ?? null,
    history: d.history ?? [],
    proposal,
    was: proposal && d.status === "corrected" && proposal.label !== d.label ? proposal.label : undefined,
    box: { x: d.x, y: d.y, w: d.width, h: d.height },
  };
}

/** Analyse réelle (entité `analysis`) → modèle de la vue. */
export function realViewModel(analysis, { imageUrl, number }) {
  const toBox = (d) => ({ x: d.x, y: d.y, w: d.width, h: d.height });
  // Une dent rejetée (fausse détection) ne compte plus ; `proposalFdi` : le
  // numéro proposé, quand le praticien l'a corrigé.
  const teeth = analysis.detections
    .filter((d) => d.label === DetectionLabel.TOOTH && d.fdi != null && d.status !== "rejected")
    .map((d) => ({
      id: d.id,
      fdi: d.fdi,
      box: toBox(d),
      cx: d.x + d.width / 2,
      upper: d.fdi < 30,
      status: d.status,
      doubtful: Boolean(d.doubtful),
      rank: d.rank ?? null,
      proposalFdi: d.proposal?.fdi ?? d.fdi,
    }));
  const dets = analysis.detections
    .filter((d) => d.label !== DetectionLabel.TOOTH)
    .map(toViewDetection);
  return {
    id: analysis.id,
    demo: false,
    number: number == null ? "—" : formatAnalysisNumber(number),
    ref: analysis.ref,
    date: formatDate(analysis.createdAt),
    time: formatTime(analysis.createdAt),
    modelVersion: analysis.modelVersion,
    // Registre : rejeu d'une autre analyse (comparaison), version demandée.
    originId: analysis.originId ?? null,
    requestedVersion: analysis.requestedVersion ?? null,
    mockInference: analysis.inferenceMode === "mock",
    processing: analysis.processing,
    error: analysis.error,
    durationMs: analysis.durationMs,
    width: analysis.width,
    height: analysis.height,
    imageUrl,
    closed: analysis.closed,
    closedAt: analysis.closedAt,
    closedBy: analysis.closedBy,
    conclusion: analysis.conclusion,
    // Ce dont les appels de relecture ont besoin (identifiant, dimensions de l'image).
    api: { id: analysis.id, width: analysis.width, height: analysis.height },
    teeth,
    dets,
    incoherences: analysis.incoherences ?? [],
    absentTeeth: analysis.absentTeeth ?? [],
  };
}

/** Numéro de dent le plus proche du centre d'un cadre tracé. */
export function nearestTooth(teeth, box) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let best = null;
  let bestDistance = Infinity;
  teeth.forEach((t) => {
    const d = Math.hypot(t.cx - cx, t.box.y + t.box.h / 2 - cy);
    if (d < bestDistance) {
      bestDistance = d;
      best = t.fdi;
    }
  });
  return best ?? 11;
}

export const STATUS_LABEL = { pending: "À revoir", validated: "Validée", corrected: "Corrigée", rejected: "Rejetée", added: "Ajoutée par le praticien" };
export const isDashed = (d) => d.source === "user" || d.status === "corrected";
export const pct = (n) => (n == null ? "—" : `${n} %`);

/**
 * Détection affichée : calque visible et confiance au-dessus du seuil (un
 * ajout du praticien, sans confiance, est toujours affiché). Filtrage local,
 * sans aucun appel au serveur.
 */
export const isVisible = (d, { show, threshold }) => Boolean(show[d.label]) && (d.confidence == null || d.confidence >= threshold);

/** Identifiant de la détection suivante (`dir` = 1) ou précédente (−1) parmi `list`, en boucle. */
export function stepDetection(list, selId, dir, sort) {
  const order = sortDetections(list, sort);
  if (!order.length) return null;
  const i = order.findIndex((d) => d.id === selId);
  const next = i < 0 ? (dir > 0 ? 0 : order.length - 1) : (i + dir + order.length) % order.length;
  return order[next].id;
}

/** Tri de la liste : par dent, par confiance ou par statut. */
export function sortDetections(list, sort) {
  const a = [...list];
  if (sort === "conf") a.sort((x, y) => (y.confidence ?? 101) - (x.confidence ?? 101));
  else if (sort === "status") {
    const o = { pending: 0, corrected: 1, added: 2, validated: 3, rejected: 4 };
    a.sort((x, y) => o[x.status] - o[y.status] || (x.fdi ?? 0) - (y.fdi ?? 0));
  } else a.sort((x, y) => (x.fdi ?? 0) - (y.fdi ?? 0) || (y.confidence ?? 0) - (x.confidence ?? 0));
  return a;
}
