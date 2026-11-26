import { describe, expect, it } from "vitest";

import { OFFLINE_STATUS, formatDuration, normalizeSupervision, normalizeSystemStatus, serviceAlerts } from "./system-status";

const health = (services, statut = "degrade") => normalizeSystemStatus({ statut, services });
const OK = { base: "ok", stockage: "ok", file: "ok", inference: "ok" };

describe("état des services", () => {
  it("page de santé → modèle", () => {
    const s = health(OK, "ok");
    expect(s).toMatchObject({ isOnline: true, inferenceReachable: true, inferenceMode: null });
    expect(health({ ...OK, inference: "panne" }).inferenceReachable).toBe(false);
    expect(health({ ...OK, stockage: "panne" }).isOnline).toBe(true);   // dégradé, pas hors ligne
  });

  it("aucune alerte quand tout va bien, ou tant que l'état est inconnu", () => {
    expect(serviceAlerts(health(OK, "ok"))).toEqual([]);
    expect(serviceAlerts(null)).toEqual([]);
  });

  it("une alerte en clair par service touché, pour tout le monde", () => {
    const alerts = serviceAlerts(health({ ...OK, inference: "panne", file: "degrade" }));
    expect(alerts.map((a) => [a.key, a.tone])).toEqual([["file", "warning"], ["inference", "danger"]]);
    expect(alerts[1].text).toBe("Le service d’analyse est indisponible : les nouvelles analyses attendront dans la file.");
    expect(serviceAlerts(health({ ...OK, stockage: "panne" }))[0].text).toMatch(/aucun import n’est possible/);
  });

  it("serveur injoignable : une seule alerte", () => {
    expect(serviceAlerts(OFFLINE_STATUS)).toEqual([expect.objectContaining({ key: "serveur", tone: "danger" })]);
  });

  it("supervision détaillée → modèle", () => {
    const s = normalizeSupervision({
      statut: "degrade",
      services: {
        base: { etat: "ok", detail: "La base répond.", latence_ms: 4 },
        stockage: { etat: "panne", detail: "Pas de réponse en 2 s.", latence_ms: 2001 },
        file: { etat: "ok", detail: "0 analyse et 0 document en attente.", latence_ms: 6 },
        inference: { etat: "inconnu" },
      },
      indicateurs: { jours: 14, analyses_par_jour: [{ jour: "2026-11-26", analyses: 3 }], duree_moyenne_ms: 2400,
        taux_echec: 0.25, traitees: 4, echouees: 1 },
    });
    expect(s.services.map((x) => [x.key, x.state, x.latencyMs])).toEqual([
      ["base", "ok", 4], ["stockage", "panne", 2001], ["file", "ok", 6], ["inference", "panne", null]]);
    expect(s.indicators).toEqual({ days: [{ day: "2026-11-26", count: 3 }], averageMs: 2400, failureRate: 0.25, processed: 4, failed: 1 });
    expect(normalizeSupervision({ statut: "ok", services: {}, indicateurs: null }).indicators).toBeNull();
  });

  it("durées lisibles", () => {
    expect([formatDuration(512), formatDuration(2400), formatDuration(null)]).toEqual(["512 ms", "2,4 s", "—"]);
  });
});
