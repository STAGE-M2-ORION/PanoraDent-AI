/**
 * Présentation des permissions du catalogue backend (`permissions.py`) :
 * regroupement, libellés courts de la matrice, permissions sensibles.
 */
export const PERMISSION_GROUPS = [
  { legend: "Analyses", codes: ["analysis:create", "analysis:read", "analysis:delete"] },
  { legend: "Revue des détections", codes: ["detection:review"] },
  { legend: "Comptes rendus", codes: ["report:generate"] },
  { legend: "Modèle", codes: ["model:read"] },
  { legend: "Administration", codes: ["user:manage", "role:manage"] },
];

const MATRIX_LABELS = {
  "analysis:create": "Analyses — créer",
  "analysis:read": "Analyses — consulter",
  "analysis:delete": "Analyses — supprimer",
  "detection:review": "Revue des détections (valider, corriger, ajouter, supprimer)",
  "report:generate": "Génération du compte rendu",
  "model:read": "Consultation de la performance du modèle",
  "user:manage": "Gestion des utilisateurs",
  "role:manage": "Gestion des rôles",
};

/** Réservées à l'administration : signalées « Sensible ». */
export const SENSITIVE_PERMISSIONS = new Set(["user:manage", "role:manage"]);

/** Ordre d'affichage : celui des groupes, puis les codes inconnus. */
export function orderedPermissions(catalog) {
  const known = PERMISSION_GROUPS.flatMap((g) => g.codes);
  const codes = catalog.map((p) => p.code);
  return [...known.filter((c) => codes.includes(c)), ...codes.filter((c) => !known.includes(c))];
}

/** Libellé court (matrice) ; à défaut, la description du catalogue. */
export function permissionLabel(code, catalog = []) {
  return MATRIX_LABELS[code] ?? catalog.find((p) => p.code === code)?.description ?? code;
}
