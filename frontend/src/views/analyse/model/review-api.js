import { addDetection, closeAnalysis, postVerdict, reopenAnalysis, saveConclusion, undoVerdict } from "@/entities/analysis";
import { Verdict } from "@/entities/detection";

import { awaitsVerdict, forReport, toViewDetection } from "@/widgets/analysis-workspace";

const STATUS_OF_VERDICT = { [Verdict.VALIDATE]: "validated", [Verdict.CORRECT]: "corrected", [Verdict.REJECT]: "rejected" };

/** Verdict à reposer pour changer le seul commentaire d'une détection déjà revue. */
export function verdictOfStatus(status) {
  if (status === "corrected") return Verdict.CORRECT;
  if (status === "rejected") return Verdict.REJECT;
  return Verdict.VALIDATE; // validée, ou ajoutée par le praticien
}

const sameBox = (a, b) => Boolean(a && b) && ["x", "y", "w", "h"].every((k) => Math.abs(a[k] - b[k]) < 0.5);

/**
 * Relecture d'une vraie analyse : chaque geste part au serveur, qui renvoie
 * la détection à jour (valeurs retenues, proposition, historique).
 */
function serverReview(api) {
  return {
    async verdict(d, verdict, { comment, label, fdi, box, originalBox } = {}) {
      const opts = { comment };
      if (verdict === Verdict.CORRECT) {
        if (label != null && label !== d.label) opts.label = label;
        if (fdi !== undefined && fdi !== d.fdi) opts.fdi = fdi;
        if (box && !sameBox(box, originalBox)) opts.box = box;
      }
      return toViewDetection(await postVerdict(api, d.id, verdict, opts));
    },
    async undo(d) {
      const next = await undoVerdict(api, d.id);
      return next ? toViewDetection(next) : null;
    },
    async add({ label, fdi, box, note }) {
      return toViewDetection(await addDetection(api, { label, fdi, box, comment: note }));
    },
    async saveConclusion(text) {
      await saveConclusion(api.id, text);
    },
    async close(conclusion) {
      const a = await closeAnalysis(api.id, conclusion);
      return { closed: a.closed, closedAt: a.closedAt, closedBy: a.closedBy, conclusion: a.conclusion };
    },
    async reopen(motif) {
      const a = await reopenAnalysis(api.id, motif);
      return { closed: a.closed, closedAt: null, closedBy: null, conclusion: a.conclusion };
    },
  };
}

/** Démonstration : mêmes gestes, rien n'est envoyé (historique tenu en mémoire). */
function localReview(reviewerName) {
  const now = () => new Date().toISOString();
  const push = (d, action, change) => {
    const history = [...(d.history ?? []), { action, comment: change.note ?? d.note ?? "", author: reviewerName, at: now(), cancelledAt: null, previous: d }];
    return { ...d, ...change, history, reviewedBy: reviewerName, reviewedAt: now() };
  };
  return {
    async verdict(d, verdict, { comment, label, fdi, box } = {}) {
      const change = { status: d.source === "user" && verdict === Verdict.VALIDATE ? "added" : STATUS_OF_VERDICT[verdict], note: comment ?? d.note };
      if (verdict === Verdict.CORRECT) {
        if (label != null) change.label = label;
        if (fdi !== undefined) change.fdi = fdi;
        if (box) change.box = box;
        if (change.label && change.label !== (d.proposal?.label ?? d.label) && d.source === "ai") change.was = d.proposal?.label ?? d.label;
      }
      return push({ ...d, proposal: d.proposal ?? { label: d.label, fdi: d.fdi, box: d.box } }, verdict, change);
    },
    async undo(d) {
      const last = [...(d.history ?? [])].reverse().find((h) => !h.cancelledAt);
      if (!last) throw new Error("Aucun verdict à annuler sur cette détection.");
      if (last.action === "ajouter") return null;
      return { ...last.previous, history: (d.history ?? []).map((h) => (h === last ? { ...h, cancelledAt: now() } : h)) };
    },
    async add({ label, fdi, box, note }) {
      const d = { id: `u${Date.now()}`, fdi, label, confidence: null, status: "added", source: "user", note: note.trim(), box: { ...box }, history: [] };
      return { ...d, history: [{ action: "ajouter", comment: d.note, author: reviewerName, at: now(), cancelledAt: null }], reviewedBy: reviewerName, reviewedAt: now() };
    },
    async saveConclusion() {},
    async close(conclusion) {
      return { closed: true, closedAt: now(), closedBy: reviewerName, conclusion };
    },
    async reopen() {
      return { closed: false, closedAt: null, closedBy: null };
    },
  };
}

export function makeReview(vm, reviewerName) {
  return vm?.api ? serverReview(vm.api) : localReview(reviewerName);
}

/** Clé de reprise de la relecture (détection sélectionnée), par analyse. */
export const resumeKey = (id) => `panoradent:relecture:${id}`;

export function readResume(id) {
  try {
    return id ? window.localStorage.getItem(resumeKey(id)) : null;
  } catch {
    return null;
  }
}

export function writeResume(id, detId) {
  try {
    if (id && detId) window.localStorage.setItem(resumeKey(id), detId);
  } catch {
    /* stockage indisponible : la reprise retombe sur la première détection à revoir */
  }
}

/**
 * Décompte pour l'écran de clôture. `pending` : détections PROPOSÉES encore
 * sans verdict (elles bloquent la clôture) ; `optional` : restées sous le seuil
 * de leur classe sans verdict (non exigé, exclues du compte rendu) ;
 * `retained` : celles qui iront au compte rendu.
 */
export function reviewSummary(dets, thresholds = null) {
  const count = (s) => dets.filter((d) => d.status === s).length;
  const pending = dets.filter((d) => awaitsVerdict(d, thresholds)).length;
  return {
    total: dets.length,
    pending,
    optional: count("pending") - pending,
    retained: dets.filter((d) => forReport(d, thresholds)).length,
    validated: count("validated"),
    corrected: count("corrected"),
    rejected: count("rejected"),
    added: count("added"),
  };
}
