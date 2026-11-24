import { describe, expect, it } from "vitest";

import { EMPTY_AUDIT_FILTERS, auditParams, normalizeAudit, spanLabel } from "./audit";

describe("journal d'audit", () => {
  it("filtres → paramètres du serveur", () => {
    expect(auditParams(EMPTY_AUDIT_FILTERS)).toEqual({ jours: 7 });
    expect(auditParams({ period: "30", author: "u1", category: "Relecture", result: "ko" })).toEqual({
      jours: 30, auteur: "u1", categorie: "Relecture", resultat: "echec",
    });
    expect(auditParams({ ...EMPTY_AUDIT_FILTERS, result: "ok" }).resultat).toBe("succes");
  });

  it("réponse → modèle : session, poste, méthode, état, entrées", () => {
    const a = normalizeAudit({
      jours: 7, total: 2, tronque: false, categories: ["Relecture"], auteurs: [{ id: "u1", nom: "Dr Rabe" }],
      sessions: [{
        id: "session:s1", utilisateur: { id: "u1", nom: "Dr Rabe" }, titre: null, poste: "Chrome · Windows", ip: "10.0.0.2",
        methode: "google", etat: "closed", ouverte_le: "2026-11-24T08:00:00", fermee_le: "2026-11-24T09:05:00",
        derniere: "2026-11-24T09:05:00",
        entrees: [
          { date: "2026-11-24T08:00:00", action: "connexion", libelle: "Connexion", categorie: "Connexions et sécurité", ok: true, cible: null, precision: "Avec Google" },
          { date: "2026-11-24T09:05:00", action: "verdict_rejeter", libelle: "Détection rejetée", categorie: "Relecture", ok: true, cible: "Analyse PDX-1", precision: "carie, dent 36" },
        ],
      }],
    });
    expect(a.groups[0]).toMatchObject({ id: "session:s1", device: "Chrome · Windows", method: "google", state: "closed" });
    expect(a.groups[0].entries[1]).toMatchObject({ label: "Détection rejetée", target: "Analyse PDX-1", detail: "carie, dent 36" });
    expect(a.authors).toEqual([{ id: "u1", name: "Dr Rabe" }]);
  });

  it("durée d'une session", () => {
    expect(spanLabel("2026-11-24T08:00:00", "2026-11-24T08:12:00")).toBe("12 min");
    expect(spanLabel("2026-11-24T08:00:00", "2026-11-24T09:05:00")).toBe("1 h 05");
    expect(spanLabel("2026-11-24T08:00:00", "2026-11-24T08:00:00")).toBeNull();
  });
});
