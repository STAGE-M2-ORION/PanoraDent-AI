import { describe, expect, it } from "vitest";

import { EMPTY_HISTORY_FILTERS, historyParams, normalizeHistoryPage, normalizeTimeline, periodBounds } from "./history";

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
