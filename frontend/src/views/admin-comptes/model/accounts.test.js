import { describe, expect, it } from "vitest";

import { accountStats, filterAccounts, sortAccounts } from "./accounts";

const u = (fullName, role, { isActive = true, lastLoginAt = null, roleId = role } = {}) => ({
  fullName, email: `${fullName.toLowerCase().replace(/\s/g, ".")}@cabinet.fr`, role, roleId, isActive,
  lastLoginAt: lastLoginAt ? new Date(lastLoginAt) : null,
});

const USERS = [
  u("Zo Rabe", "Praticien", { lastLoginAt: "2026-11-01" }),
  u("Aina Rakoto", "Administrateur", { lastLoginAt: "2026-11-19" }),
  u("Hery Rasoa", "Praticien"),
  u("Fara Lecteur", "Lecteur", { isActive: false, lastLoginAt: "2026-10-01" }),
];

describe("liste des comptes", () => {
  it("filtre par texte, rôle et statut (dont « jamais connectés »)", () => {
    expect(filterAccounts(USERS, { q: "RAKO" }).map((x) => x.fullName)).toEqual(["Aina Rakoto"]);
    expect(filterAccounts(USERS, { role: "Praticien" })).toHaveLength(2);
    expect(filterAccounts(USERS, { status: "desactive" }).map((x) => x.fullName)).toEqual(["Fara Lecteur"]);
    expect(filterAccounts(USERS, { status: "jamais" }).map((x) => x.fullName)).toEqual(["Hery Rasoa"]);
  });

  it("trie par nom, rôle, statut et dernière connexion", () => {
    expect(sortAccounts(USERS).map((x) => x.fullName)[0]).toBe("Aina Rakoto");
    expect(sortAccounts(USERS, { key: "name", dir: "desc" })[0].fullName).toBe("Zo Rabe");
    expect(sortAccounts(USERS, { key: "role" }).map((x) => x.role)).toEqual(["Administrateur", "Lecteur", "Praticien", "Praticien"]);
    expect(sortAccounts(USERS, { key: "status", dir: "desc" })[0].fullName).toBe("Fara Lecteur");
    const recents = sortAccounts(USERS, { key: "lastLogin", dir: "desc" }).map((x) => x.fullName);
    expect(recents).toEqual(["Aina Rakoto", "Zo Rabe", "Fara Lecteur", "Hery Rasoa"]); // jamais connecté en dernier
  });

  it("indicateurs d'administration", () => {
    expect(accountStats(USERS)).toEqual({
      total: 4,
      byRole: [["Praticien", 2], ["Administrateur", 1], ["Lecteur", 1]],
      neverLoggedIn: 1,
      disabled: 1,
    });
  });
});
