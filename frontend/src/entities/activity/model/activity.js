/**
 * Activité du tableau de bord (sprint 12) : `GET /tableau-de-bord/activite`.
 * Portée « moi » (praticien) ou « cabinet » (lecteur). Des nombres comptés,
 * jamais estimés ; aucun patient.
 */
export function normalizeActivity(dto) {
  const a = dto.analyses ?? {};
  const d = dto.detections ?? {};
  const proposed = d.proposees ?? 0;
  const reviewed = d.relues ?? 0;
  return {
    scope: dto.portee ?? "moi",
    analyses: {
      thisMonth: a.ce_mois ?? 0,
      lastMonth: a.mois_precedent ?? 0,
      inProgress: a.en_cours ?? 0,
      toReview: a.a_relire ?? 0,
      closed: a.cloturees ?? 0,
      failed: a.echouees ?? 0,
    },
    detections: { proposed, reviewed, pending: proposed - reviewed, pct: proposed ? Math.round((reviewed / proposed) * 100) : null },
    types: Object.entries(dto.types ?? {})
      .map(([label, count]) => ({ label, count }))
      .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label)),
    meanCloseSeconds: dto.delai_moyen_cloture_s ?? null,
    reports: { last30: dto.comptes_rendus?.trente_jours ?? 0, previous30: dto.comptes_rendus?.trente_jours_precedents ?? 0 },
    weeks: (dto.semaines ?? []).map((s) => ({ start: s.debut, closed: s.clotures ?? 0, reports: s.comptes_rendus ?? 0 })),
  };
}

/** Durée lisible : « 45 s », « 6 min 40 », « 2 h 05 », « 3 j 4 h ». */
export function formatDuration(seconds) {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const r = s % 60;
    return r ? `${Math.floor(s / 60)} min ${String(r).padStart(2, "0")}` : `${s / 60} min`;
  }
  if (s < 86400) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  const h = Math.floor((s % 86400) / 3600);
  return `${Math.floor(s / 86400)} j${h ? ` ${h} h` : ""}`;
}

/** Écart avec la période précédente : « +5 vs 30 jours précédents ». */
export function periodDelta(now, before, period = "30 jours précédents") {
  const d = now - before;
  if (d === 0) return `Comme les ${period}`;
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} vs ${period}`;
}

/** Semaine ISO d'une date « AAAA-MM-JJ » (un lundi) : « S46 ». */
function isoWeek(iso) {
  const [y, m, j] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, j));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const debut = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - debut) / 864e5 + 1) / 7);
}

export const weekLabels = (weeks) => weeks.map((w) => `S${isoWeek(w.start)}`);
