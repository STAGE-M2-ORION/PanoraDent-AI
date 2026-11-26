import { describe, expect, it } from "vitest";

import { normalizeIndicators, weekDelta } from "./indicators";

describe("indicateurs d'administration", () => {
  it("réponse → modèle", () => {
    const i = normalizeIndicators({
      comptes: { total: 6, actifs: 5, desactives: 1, jamais_connectes: 2, par_role: [{ role: "Praticien", total: 4, actifs: 3 }] },
      analyses: { ce_mois: 12, mois_precedent: 9, en_attente: 1 },
      connexions: { semaine: 41, semaine_precedente: 38, echecs_semaine: 3, echecs_semaine_precedente: 5 },
      nouveaux_comptes_par_mois: [{ mois: "2026-11", comptes: 2 }],
    });
    expect(i.accounts).toMatchObject({ total: 6, active: 5, neverLoggedIn: 2, byRole: [{ role: "Praticien", total: 4, active: 3 }] });
    expect(i.logins).toEqual({ week: 41, lastWeek: 38, failures: 3, lastWeekFailures: 5 });
    expect(i.newAccounts).toEqual([{ month: "2026-11", count: 2 }]);
    expect(normalizeIndicators({}).accounts.total).toBe(0);
  });

  it("écart avec la semaine précédente", () => {
    expect([weekDelta(41, 38), weekDelta(3, 5), weekDelta(2, 2)]).toEqual(["+3 vs semaine dernière", "−2 vs semaine dernière", "Comme la semaine dernière"]);
  });
});
