import { describe, expect, it } from "vitest";

import { formatDuration, normalizeActivity, periodDelta, weekLabels } from "./activity";

describe("activité du tableau de bord", () => {
  it("réponse → modèle", () => {
    const a = normalizeActivity({
      portee: "cabinet",
      analyses: { ce_mois: 4, mois_precedent: 2, en_cours: 1, a_relire: 2, cloturees: 9, echouees: 1 },
      detections: { proposees: 20, relues: 15 },
      types: { caries: 3, impacted_tooth: 7, periapical_lesion: 3 },
      delai_moyen_cloture_s: 400,
      comptes_rendus: { trente_jours: 5, trente_jours_precedents: 2 },
      semaines: [{ debut: "2026-11-23", clotures: 2, comptes_rendus: 1 }],
    });
    expect(a.scope).toBe("cabinet");
    expect(a.analyses).toEqual({ thisMonth: 4, lastMonth: 2, inProgress: 1, toReview: 2, closed: 9, failed: 1 });
    expect(a.detections).toEqual({ proposed: 20, reviewed: 15, pending: 5, pct: 75 });
    expect(a.types.map((t) => t.label)).toEqual(["impacted_tooth", "caries", "periapical_lesion"]);
    expect(a.weeks).toEqual([{ start: "2026-11-23", closed: 2, reports: 1 }]);
    expect(a.reports).toEqual({ last30: 5, previous30: 2 });
  });

  it("rien à compter : pas de pourcentage inventé", () => {
    const a = normalizeActivity({});
    expect(a.detections.pct).toBeNull();
    expect(a.meanCloseSeconds).toBeNull();
    expect(a.types).toEqual([]);
  });

  it("durées lisibles", () => {
    expect([formatDuration(45), formatDuration(400), formatDuration(600), formatDuration(7500), formatDuration(3 * 86400 + 4 * 3600), formatDuration(null)])
      .toEqual(["45 s", "6 min 40", "10 min", "2 h 05", "3 j 4 h", "—"]);
  });

  it("écart et semaines ISO", () => {
    expect([periodDelta(5, 2), periodDelta(1, 3), periodDelta(2, 2)]).toEqual(["+3 vs 30 jours précédents", "−2 vs 30 jours précédents", "Comme les 30 jours précédents"]);
    expect(weekLabels([{ start: "2026-11-23" }, { start: "2026-01-05" }, { start: "2025-12-29" }])).toEqual(["S48", "S2", "S1"]);
  });
});
