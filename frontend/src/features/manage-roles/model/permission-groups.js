/**
 * Présentation des permissions du catalogue backend (`GET /permissions`) :
 * regroupement, libellés courts de la matrice, permissions sensibles.
 */
export const PERMISSION_GROUPS = [
  { legend: "Analyses", codes: ["analysis:create", "analysis:read", "analysis:delete"] },
  { legend: "Revue des détections", codes: ["detection:review", "analysis:reopen"] },
  { legend: "Comptes rendus", codes: ["report:generate"] },
  { legend: "Modèle", codes: ["model:read", "model:manage"] },
  { legend: "Administration", codes: ["user:manage", "role:manage"] },
];

const MATRIX_LABELS = {
  "analysis:create": "Analyses — créer",
  "analysis:read": "Analyses — consulter",
  "analysis:delete": "Analyses — supprimer",
  "detection:review": "Revue des détections (valider, corriger, ajouter, supprimer)",
  "analysis:reopen": "Réouverture d’une analyse clôturée (motif obligatoire)",
  "report:generate": "Génération du compte rendu",
  "model:read": "Consultation de la performance du modèle",
  "model:manage": "Activation d’une version de modèle (bascule)",
  "user:manage": "Gestion des utilisateurs",
  "role:manage": "Gestion des rôles",
};

/** Réservées à l'administration : signalées « Sensible ». */
// La réouverture lève le verrou d'une analyse clôturée : réservée, elle aussi.
export const SENSITIVE_PERMISSIONS = new Set(["user:manage", "role:manage", "model:manage", "analysis:reopen"]);

/** Ordre d'affichage : celui des groupes, puis les codes inconnus. */
export function orderedPermissions(catalog) {
  const known = PERMISSION_GROUPS.flatMap((g) => g.codes);
  const codes = catalog.map((p) => p.code);
  return [...known.filter((c) => codes.includes(c)), ...codes.filter((c) => !known.includes(c))];
}

/** Libellé court (matrice) ; à défaut, le libellé du catalogue. */
export function permissionLabel(code, catalog = []) {
  return MATRIX_LABELS[code] ?? catalog.find((p) => p.code === code)?.label ?? code;
}
