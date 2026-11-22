import { describe, expect, it } from "vitest";

import { TYPES_BY_URGENCY, anomalySummary, filtersText, matchesFilters, quadrantOf } from "./summary";

const det = (id, label, fdi, confidence = 80, status = "pending") => ({ id, label, fdi, confidence, status });

const dets = [
  det("a", "caries", 16),
  det("b", "caries", 26),
  det("c", "caries", 36, 30), // sous le seuil de 50
  det("d", "deep_caries", 46),
  det("e", "periapical_lesion", 46, 90, "validated"),
  det("f", "impacted_tooth", 38, 70, "rejected"), // rejetée : hors résumé
  det("g", "caries", null, null, "added"), // ajout sans numéro valide
];

describe("résumé des anomalies", () => {
  it("compte par type et par quadrant les anomalies retenues", () => {
    const s = anomalySummary(dets, { threshold: 50 });
    const row = (label) => s.rows.find((r) => r.label === label);
    expect(row("caries")).toEqual({ label: "caries", counts: { 1: 1, 2: 1, 3: 0, 4: 0 }, unnumbered: 1, total: 3 });
    expect(row("deep_caries").counts[4]).toBe(1);
    expect(row("impacted_tooth").total).toBe(0);
    expect(s.byQuadrant).toEqual({ 1: 1, 2: 1, 3: 0, 4: 2 });
    expect(s).toMatchObject({ total: 5, unnumbered: 1, pending: 3 });
  });

  it("un seuil plus bas fait entrer les propositions moins sûres", () => {
    expect(anomalySummary(dets, { threshold: 0 }).byQuadrant[3]).toBe(1);
  });

  it("range les types par urgence : prioritaires d'abord", () => {
    expect(TYPES_BY_URGENCY).toEqual(["deep_caries", "periapical_lesion", "caries", "impacted_tooth"]);
  });
});

describe("filtres de la liste", () => {
  it("quadrant, dent et type se cumulent", () => {
    const ids = (f) => dets.filter((d) => matchesFilters(d, f)).map((d) => d.id);
    expect(ids({ quadrant: 4 })).toEqual(["d", "e"]);
    expect(ids({ quadrant: 4, type: "deep_caries" })).toEqual(["d"]);
    expect(ids({ tooth: 26 })).toEqual(["b"]);
    expect(ids({})).toHaveLength(dets.length);
  });

  it("quadrant d'un numéro FDI, rien pour un numéro absent ou temporaire", () => {
    expect([quadrantOf(11), quadrantOf(48), quadrantOf(null), quadrantOf(55)]).toEqual([1, 4, null, null]);
  });

  it("décrit les filtres actifs", () => {
    expect(filtersText({ quadrant: 2, type: "caries" }, () => "Carie")).toBe("carie, quadrant 2 (maxillaire gauche)");
    expect(filtersText({ tooth: 36, quadrant: 3 })).toBe("dent 36");
  });
});
