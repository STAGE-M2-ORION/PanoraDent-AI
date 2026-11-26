/**
 * Indicateurs agrégés du tableau de bord d'administration (sprint 11) :
 * `GET /administration/indicateurs`. Des comptes, jamais des personnes.
 */
export function normalizeIndicators(dto) {
  const c = dto.comptes ?? {};
  return {
    accounts: {
      total: c.total ?? 0,
      active: c.actifs ?? 0,
      disabled: c.desactives ?? 0,
      neverLoggedIn: c.jamais_connectes ?? 0,
      byRole: (c.par_role ?? []).map((r) => ({ role: r.role, total: r.total, active: r.actifs })),
    },
    analyses: { thisMonth: dto.analyses?.ce_mois ?? 0, lastMonth: dto.analyses?.mois_precedent ?? 0, pending: dto.analyses?.en_attente ?? 0 },
    logins: {
      week: dto.connexions?.semaine ?? 0,
      lastWeek: dto.connexions?.semaine_precedente ?? 0,
      failures: dto.connexions?.echecs_semaine ?? 0,
      lastWeekFailures: dto.connexions?.echecs_semaine_precedente ?? 0,
    },
    newAccounts: (dto.nouveaux_comptes_par_mois ?? []).map((m) => ({ month: m.mois, count: m.comptes })),
  };
}

/** Écart lisible avec la période précédente : « +3 vs semaine dernière », « = ». */
export function weekDelta(now, before) {
  const d = now - before;
  if (d === 0) return "Comme la semaine dernière";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} vs semaine dernière`;
}
