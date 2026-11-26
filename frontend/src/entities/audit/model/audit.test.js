import { describe, expect, it } from "vitest";

import { EMPTY_AUDIT_FILTERS, auditParams, mergeAudit, normalizeAudit, normalizeAuditEntry, spanLabel } from "./audit";

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

describe("journal d'audit : consultation (sprint 11)", () => {
  const groupe = (id, entrees) => ({ id, utilisateur: { id: "u1", nom: "Dr Rabe" }, etat: "closed", derniere: entrees.at(-1).date, entrees });
  const entree = (id, date, action = "verdict_valider") => ({ id, date, action, libelle: action, categorie: "Relecture", ok: true });

  it("filtres d'action, de cible et curseur", () => {
    expect(auditParams({ ...EMPTY_AUDIT_FILTERS, action: "connexion", target: "  PDX-0042 " }, "2026-11-24T08:00:00|j:abc")).toEqual({
      jours: 7, action: "connexion", cible: "PDX-0042", avant: "2026-11-24T08:00:00|j:abc",
    });
  });

  it("page plus ancienne fusionnée : une session à cheval reste un seul groupe", () => {
    const recente = normalizeAudit({ total: 2, tronque: true, suivant: "c1", sessions: [
      groupe("session:s1", [entree("j:2", "2026-11-24T09:00:00")]), groupe("session:s2", [entree("j:3", "2026-11-24T10:00:00")])] });
    const ancienne = normalizeAudit({ total: 2, tronque: false, suivant: null, sessions: [
      groupe("session:s1", [entree("j:0", "2026-11-24T08:00:00", "connexion"), entree("j:1", "2026-11-24T08:30:00")])] });
    const m = mergeAudit(recente, ancienne);
    expect(m.groups.map((g) => g.id)).toEqual(["session:s2", "session:s1"]);
    expect(m.groups[1].entries.map((e) => e.id)).toEqual(["j:0", "j:1", "j:2"]);
    expect([m.total, m.next, m.truncated]).toEqual([4, null, false]);
  });

  it("détail d'une entrée : contexte lisible", () => {
    const d = normalizeAuditEntry({ id: "j:1", source: "journal", date: "2026-11-24T08:00:00", action: "analyse_traitee",
      libelle: "Analyse par le modèle terminée", categorie: "Analyses", ok: true, cible: "Analyse PDX-1",
      details: { modele: "v1", detections: 3, vide: "", cadre: { x: 0.1 } }, session: null });
    expect(d.context).toEqual([["modele", "v1"], ["detections", "3"], ["cadre", '{"x":0.1}']]);
  });
});
