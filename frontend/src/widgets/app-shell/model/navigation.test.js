import { describe, expect, it } from "vitest";

import { NAVIGATION, visibleNavigation } from "./navigation";

/** Permissions des rôles système (cf. backend/app/permissions.py). */
const PRATICIEN = ["analysis:create", "analysis:read", "analysis:delete", "detection:review", "report:generate", "model:read", "assistant:use"];
const LECTEUR = ["analysis:read", "model:read"];
const ADMIN = [...PRATICIEN, "analysis:reopen", "model:manage", "user:manage", "role:manage", "cabinet:manage", "document:manage"];

const pour = (perms) => {
  const can = (p) => perms.includes(p);
  return visibleNavigation(can, (list) => list.some(can));
};

describe("navigation selon les droits (sprint 11)", () => {
  it("ni le praticien ni le lecteur ne voient l'administration", () => {
    for (const perms of [PRATICIEN, LECTEUR]) {
      const items = pour(perms);
      expect(items.some((i) => i.admin)).toBe(false);
      expect(items.some((i) => String(i.href ?? "").startsWith("/admin"))).toBe(false);
    }
  });

  it("l'administrateur voit chaque écran d'administration", () => {
    const hrefs = pour(ADMIN).map((i) => i.href).filter(Boolean);
    const attendus = NAVIGATION.filter((i) => i.admin && i.href).map((i) => i.href);
    expect(attendus).toEqual(expect.arrayContaining(["/admin/comptes", "/admin/audit", "/admin/supervision", "/admin/cabinet", "/admin/documents"]));
    expect(hrefs).toEqual(expect.arrayContaining(attendus));
  });

  it("le lecteur n'a ni import ni analyse nouvelle", () => {
    expect(pour(LECTEUR).map((i) => i.href)).not.toContain("/nouvelle-analyse");
  });
});
