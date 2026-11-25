/**
 * Performances d'une version de modèle (sprint 10), LUES au registre : les
 * mesures écrites par `publish_model.py` à la publication, jamais recalculées
 * à l'ouverture de la page (une page qui réévaluerait le test finirait par en
 * faire un jeu de réglage). Une mesure absente reste absente : aucun chiffre
 * n'est inventé.
 */
export const ANOMALY_CLASSES = ["caries", "deep_caries", "periapical_lesion", "impacted_tooth"];

export const CLASS_LABELS = {
  tooth: "Dent",
  caries: "Carie",
  deep_caries: "Carie profonde",
  periapical_lesion: "Lésion péri-apicale",
  impacted_tooth: "Dent incluse",
  fond: "Fond (manqué ou inventé)",
};

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** « 0,49 » ; « — » si absente. */
export function formatScore(v) {
  return num(v) === null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** « 42 % » ; « — » si absente. */
export function formatShare(v) {
  return num(v) === null ? "—" : `${Math.round(v * 100)} %`;
}

function globalMetrics(m) {
  if (num(m.map50) === null) return null;
  const g = m.anomalies?.detection?.global ?? {};
  return {
    map50: m.map50,
    map5095: num(g.mAP50_95),
    precision: num(m.precision),
    recall: num(m.recall),
    testImages: num(m.test_images),
    partition: m.partition ?? null,
  };
}

function perClass(m) {
  const det = m.anomalies?.detection?.par_classe;
  if (!det) return [];
  const img = m.anomalies?.niveau_image?.par_classe ?? {};
  return ANOMALY_CLASSES.filter((c) => det[c]).map((c) => ({
    cls: c,
    label: CLASS_LABELS[c],
    instances: num(det[c].instances),
    precision: num(det[c].precision),
    recall: num(det[c].rappel),
    map50: num(det[c].mAP50),
    sensitivity: num(img[c]?.sensibilite),
    specificity: num(img[c]?.specificite),
  }));
}

/** Matrice de confusion (jeu de test), sans les lignes et colonnes entièrement vides. */
function confusion(m) {
  const c = m.anomalies?.detection?.confusion;
  if (!c?.etiquettes || !c?.matrice) return null;
  const keep = c.etiquettes
    .map((_, i) => i)
    .filter((i) => c.matrice[i].some((v) => v > 0) || c.matrice.some((row) => row[i] > 0));
  return {
    labels: keep.map((i) => CLASS_LABELS[c.etiquettes[i]] ?? c.etiquettes[i]),
    matrix: keep.map((i) => keep.map((j) => c.matrice[i][j])),
    reading: c.lecture ?? null,
  };
}

/** Seuils d'exploitation et courbes de seuil (validation), s'ils ont été publiés. */
function thresholds(m) {
  const s = m.seuils_exploitation;
  if (!s?.par_classe) return null;
  return ANOMALY_CLASSES.filter((c) => s.par_classe[c]).map((c) => {
    const chosen = s.par_classe[c];
    return {
      cls: c,
      label: CLASS_LABELS[c],
      chosen: {
        threshold: chosen.seuil,
        recall: num(chosen.rappel),
        precision: num(chosen.precision),
        falseAlarms: num(chosen.fausses_alertes_par_cliche),
        target: num(chosen.cible),
        reached: Boolean(chosen.atteinte),
      },
      curve: (s.courbes?.[c] ?? []).map(([threshold, recall, precision]) => ({ threshold, recall, precision })),
    };
  });
}

export function performanceOf(version) {
  const m = version?.metrics ?? {};
  const externe = m.externe?.detection?.global;
  return {
    version: version?.version ?? null,
    splitHash: version?.splitHash ?? null,
    global: globalMetrics(m),
    perClass: perClass(m),
    confusion: confusion(m),
    thresholds: thresholds(m),
    external: externe ? { map50: num(externe.mAP50), precision: num(externe.precision), recall: num(externe.rappel) } : null,
  };
}

/** Effet du seuil retenu, en clair pour le praticien. */
export function thresholdSentence(t) {
  const c = t.chosen;
  const parts = [`Au seuil retenu de ${formatScore(c.threshold)}, le modèle retrouve ${formatShare(c.recall)} des ${t.label.toLowerCase()}s de la validation`];
  if (c.precision !== null) parts.push(`${formatShare(c.precision)} de ses propositions sont justes`);
  if (c.falseAlarms !== null) parts.push(`environ ${c.falseAlarms.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} fausse${c.falseAlarms >= 2 ? "s" : ""} alerte${c.falseAlarms >= 2 ? "s" : ""} par cliché`);
  let sentence = `${parts.join(" ; ")}.`;
  if (c.target !== null && !c.reached) sentence += ` L’objectif de ${formatShare(c.target)} de rappel n’est pas atteint : des ${t.label.toLowerCase()}s passeront inaperçues.`;
  return sentence;
}

/**
 * Comparaison de deux versions. Elle n'a de sens qu'à jeu de test identique
 * (même empreinte du découpage) : sinon, les colonnes sont montrées côte à
 * côte, sans écart ni conclusion.
 */
export function compareVersions(a, b) {
  const pa = performanceOf(a);
  const pb = performanceOf(b);
  const comparable = Boolean(pa.splitHash) && pa.splitHash === pb.splitHash;
  const byClass = (p) => Object.fromEntries(p.perClass.map((r) => [r.cls, r]));
  const ca = byClass(pa);
  const cb = byClass(pb);
  const row = (label, va, vb) => ({
    label,
    a: va,
    b: vb,
    delta: comparable && va !== null && vb !== null ? Math.round((vb - va) * 100) / 100 : null,
  });
  const rows = [row("Toutes classes — mAP@50", pa.global?.map50 ?? null, pb.global?.map50 ?? null)];
  for (const c of ANOMALY_CLASSES) {
    if (ca[c] || cb[c]) rows.push(row(`${CLASS_LABELS[c]} — mAP@50`, ca[c]?.map50 ?? null, cb[c]?.map50 ?? null));
  }
  return { comparable, rows, a: pa, b: pb };
}

/** Écart signé lisible : « +0,05 », « −0,12 », « = ». */
export function formatDelta(d) {
  if (d === null) return "—";
  if (d === 0) return "=";
  return `${d > 0 ? "+" : "−"}${formatScore(Math.abs(d))}`;
}
