import { describe, expect, it } from "vitest";

import { normalizeAccessRequest, suggestedRoleName, validateAccessRequest } from "./access-request";

const form = { name: "Rasoa Hery", email: "hery@cabinet.mg", profile: "Chirurgien-dentiste", office: "", city: "", message: "" };

describe("demandes d'accès", () => {
  it("réponse → modèle", () => {
    const d = normalizeAccessRequest({ id: "d1", nom: "Rasoa Hery", email: "hery@cabinet.mg", profil: "Autre", statut: "en_attente", cree_le: "2026-11-27T08:00:00Z" });
    expect(d).toMatchObject({ id: "d1", name: "Rasoa Hery", profile: "Autre", status: "en_attente", office: "", decidedAt: null });
  });

  it("contrôle avant envoi", () => {
    expect(validateAccessRequest(form)).toBeNull();
    expect(validateAccessRequest({ ...form, name: " " })).toMatch(/nom/);
    expect(validateAccessRequest({ ...form, email: "pas-une-adresse" })).toMatch(/e-mail/);
    expect(validateAccessRequest({ ...form, profile: "Autre" })).toMatch(/profil/);
    expect(validateAccessRequest({ ...form, message: "x".repeat(1001) })).toMatch(/1 000/);
  });

  it("rôle proposé selon le profil", () => {
    expect([suggestedRoleName("Chirurgien-dentiste"), suggestedRoleName("Patient")]).toEqual(["Praticien", "Lecteur"]);
  });
});
