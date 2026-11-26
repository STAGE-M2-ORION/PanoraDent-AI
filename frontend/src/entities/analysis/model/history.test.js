import { describe, expect, it } from "vitest";

import { EMPTY_HISTORY_FILTERS, filtersToQuery, filtersToView, formatSort, historyParams, normalizeHistoryPage, normalizeTimeline, parseSort, periodBounds, queryToFilters, viewToFilters } from "./history";

const JOUR = new Date(2026, 10, 23); // 23/11/2026, heure locale

describe("historique : filtres → requête", () => {
  it("aucun filtre : aucun paramètre (tri par défaut omis)", () => {
    expect(historyParams(EMPTY_HISTORY_FILTERS, {}, JOUR).toString()).toBe("");
  });

  it("tous les filtres, types répétés, curseur et taille de page", () => {
    const p = historyParams(
      { q: " 0042 ", owner: "mine", period: "7", status: "closed", types: ["caries", "impacted_tooth"], from: "", to: "", sort: "ancien" },
      { cursor: "abc", limit: 10 },
      JOUR,
    );
    expect(p.toString()).toBe("q=0042&deposant=moi&etat=closed&du=2026-11-16&au=2026-11-23&types=caries&types=impacted_tooth&tri=ancien&limite=10&apres=abc");
    expect(historyParams({ ...EMPTY_HISTORY_FILTERS, owner: "8c1e-uuid" }, {}, JOUR).get("deposant")).toBe("8c1e-uuid");
  });

  it("périodes : aujourd'hui, 30 jours, personnalisée", () => {
    expect(periodBounds({ period: "today" }, JOUR)).toEqual({ du: "2026-11-23", au: "2026-11-23" });
    expect(periodBounds({ period: "30" }, JOUR)).toEqual({ du: "2026-10-24", au: "2026-11-23" });
    expect(periodBounds({ period: "custom", from: "2026-11-01", to: "" }, JOUR)).toEqual({ du: "2026-11-01", au: "" });
  });
});

describe("historique : réponses → modèles", () => {
  it("page : n° et anomalies retenues donnés par le serveur", () => {
    const page = normalizeHistoryPage({
      elements: [{ id: "a", reference: "PDX-2026-0007", created_at: "2026-11-07T08:00:00", statut: "terminee", cloturee: true, revues: 1,
                   numero: 7, anomalies_retenues: 2, cloturee_le: "2026-11-08T09:00:00", n_detections: 3, labels: ["caries"] }],
      total: 25, suivant: "curseur", deposants: [{ id: "u1", nom: "Dr Rabe" }],
    });
    expect(page.items[0]).toMatchObject({ ref: "PDX-2026-0007", number: 7, retainedCount: 2, status: "closed", closedAt: "2026-11-08T09:00:00" });
    expect(page).toMatchObject({ total: 25, next: "curseur", depositors: [{ id: "u1", name: "Dr Rabe" }] });
  });

  it("fiche : événements typés (verdict, compte rendu, autre)", () => {
    const t = normalizeTimeline({ reference: "PDX-1", evenements: [
      { date: "d1", action: "import_analyse", libelle: "Panoramique importée et anonymisée", auteur: "Dr Rabe", precision: null, annule_le: null },
      { date: "d2", action: "verdict_rejeter", libelle: "Détection rejetée", auteur: "Dr Rabe", precision: "carie, dent 36", annule_le: "d3" },
      { date: "d4", action: "compte_rendu_telecharge", libelle: "Compte rendu téléchargé", auteur: null, precision: "avec image" },
    ] });
    expect(t.events.map((e) => e.kind)).toEqual(["event", "verdict", "report"]);
    expect(t.events[1]).toMatchObject({ detail: "carie, dent 36", cancelledAt: "d3" });
  });
});

describe("historique avancé (sprint 12)", () => {
  const base = { ...EMPTY_HISTORY_FILTERS, types: [] };

  it("tri multi-colonnes : lecture et écriture", () => {
    expect(parseSort("recent")).toEqual([{ field: "date", desc: true }]);
    expect(parseSort("-statut,examen")).toEqual([{ field: "statut", desc: true }, { field: "examen", desc: false }]);
    expect(parseSort("prix,date")).toEqual([{ field: "date", desc: false }]);
    expect(formatSort([{ field: "date", desc: true }])).toBe("recent");
    expect(formatSort([{ field: "date", desc: false }])).toBe("ancien");
    expect(formatSort([{ field: "statut", desc: false }, { field: "date", desc: true }])).toBe("statut,-date");
  });

  it("nouveaux filtres envoyés au serveur", () => {
    const p = historyParams({ ...base, tooth: "36", report: "telecharge", sort: "statut,-date" });
    expect(p.get("dent")).toBe("36");
    expect(p.get("compte_rendu")).toBe("telecharge");
    expect(p.get("tri")).toBe("statut,-date");
  });

  it("adresse de la page : aller-retour, « mes analyses » partageable", () => {
    const f = { ...base, q: " lésion ", owner: "mine", period: "custom", from: "2026-11-01", to: "2026-11-30", status: "closed", types: ["caries", "deep_caries"], tooth: "46", report: "non_telecharge", sort: "statut,-date" };
    const query = filtersToQuery(f, "u-moi");
    expect(query).toEqual({ q: "lésion", deposant: "u-moi", periode: "custom", du: "2026-11-01", au: "2026-11-30", etat: "closed", types: ["caries", "deep_caries"], dent: "46", cr: "non_telecharge", tri: "statut,-date" });
    // Chez l'auteur : « Moi » ; chez un confrère : le même déposant, nommé.
    expect(queryToFilters(query, "u-moi")).toEqual({ ...f, q: "lésion" });
    expect(queryToFilters(query, "u-autre").owner).toBe("u-moi");
    expect(filtersToQuery(base)).toEqual({});
  });

  it("adresse de la page : valeurs inconnues ignorées", () => {
    const f = queryToFilters({ etat: "perdu", periode: "hier", dent: "99", cr: "oui", tri: "prix", types: "caries" }, null, ["caries"]);
    expect(f).toEqual({ ...base, types: ["caries"] });
  });

  it("vues : période relative gardée, aller-retour", () => {
    const f = { ...base, owner: "mine", period: "7", types: ["caries"], tooth: "36", sort: "reference" };
    const v = filtersToView(f);
    expect(v).toEqual({ deposant: "moi", periode: "7", types: ["caries"], dent: 36, tri: "reference" });
    expect(viewToFilters(v)).toEqual(f);
    expect(viewToFilters({ du: "2026-11-01" })).toMatchObject({ period: "custom", from: "2026-11-01" });
  });
});
