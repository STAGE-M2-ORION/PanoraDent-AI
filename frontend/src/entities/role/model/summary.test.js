import { describe, expect, it } from "vitest";

import { frenchList, summarizeRole } from "./summary";

describe("résumé en clair d'un rôle", () => {
  it("liste à la française", () => {
    expect(frenchList(["a"])).toBe("a");
    expect(frenchList(["a", "b"])).toBe("a et b");
    expect(frenchList(["a", "b", "c"])).toBe("a, b et c");
  });

  it("Lecteur : consulte, et dit ce qu'il ne peut pas faire", () => {
    const s = summarizeRole(["analysis:read", "model:read"]);
    expect(s.can).toBe("Peut consulter les analyses et consulter la performance du modèle.");
    expect(s.cannot).toMatch(/^Ne peut pas importer et lancer des analyses, /);
    expect(s.cannot).toMatch(/modifier les rôles et leurs permissions\.$/);
    expect(s.admin).toBe(false);
  });

  it("signale un rôle d'administration", () => {
    expect(summarizeRole(["user:manage"]).admin).toBe(true);
  });

  it("rôle vide : le dit clairement", () => {
    expect(summarizeRole([])).toMatchObject({ can: expect.stringMatching(/aucune permission/), cannot: "" });
  });

  it("tout accordé : rien à refuser", () => {
    const all = ["analysis:read", "analysis:create", "analysis:delete", "detection:review", "report:generate", "model:read", "user:manage", "role:manage"];
    expect(summarizeRole(all).cannot).toBe("");
  });
});
