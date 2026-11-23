import { describe, expect, it } from "vitest";

import { PERMISSION_GROUPS, SENSITIVE_PERMISSIONS, orderedPermissions, permissionLabel } from "./permission-groups";

// Catalogue du backend (`app/permissions.py`) : chaque code doit avoir sa place à l'écran.
const CATALOGUE = [
  "analysis:read", "analysis:create", "analysis:delete", "analysis:reopen", "detection:review",
  "report:generate", "model:read", "model:manage", "user:manage", "role:manage",
];

describe("permissions présentées à l'écran des rôles", () => {
  it("toute permission du catalogue appartient à un groupe (aucune invisible)", () => {
    const groupees = PERMISSION_GROUPS.flatMap((g) => g.codes);
    expect(CATALOGUE.filter((c) => !groupees.includes(c))).toEqual([]);
  });

  it("la réouverture d'une analyse clôturée : groupe de la revue, libellé clair, sensible", () => {
    expect(PERMISSION_GROUPS.find((g) => g.codes.includes("analysis:reopen")).legend).toBe("Revue des détections");
    expect(permissionLabel("analysis:reopen")).toMatch(/Réouverture d’une analyse clôturée/);
    expect(SENSITIVE_PERMISSIONS.has("analysis:reopen")).toBe(true);
    const ordre = orderedPermissions(CATALOGUE.map((code) => ({ code })));
    expect(ordre.indexOf("analysis:reopen")).toBe(ordre.indexOf("detection:review") + 1);
  });
});
