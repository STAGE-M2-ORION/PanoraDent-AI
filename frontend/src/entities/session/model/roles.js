/** Rôles système (cf. backend `permissions.py`). Les autres sont personnalisés. */
export const SystemRole = {
  ADMIN: "admin",
  PRACTITIONER: "practitioner",
  VIEWER: "viewer",
};

const ROLE_LABEL = {
  [SystemRole.ADMIN]: "Administrateur",
  [SystemRole.PRACTITIONER]: "Praticien",
  [SystemRole.VIEWER]: "Lecteur",
};

/** Libellé affiché d'un rôle (« practitioner » → « Praticien »). */
export function roleLabel(role) {
  return ROLE_LABEL[role] ?? role ?? "—";
}

/** Nom affiché d'un utilisateur : nom complet, à défaut l'e-mail. */
export function displayName(user) {
  return user?.fullName?.trim() || user?.email || "";
}

/** Codes de permission (cf. backend `permissions.py`). */
export const Permission = {
  ANALYSIS_CREATE: "analysis:create",
  ANALYSIS_READ: "analysis:read",
  ANALYSIS_DELETE: "analysis:delete",
  DETECTION_REVIEW: "detection:review",
  REPORT_GENERATE: "report:generate",
  MODEL_READ: "model:read",
  USER_MANAGE: "user:manage",
  ROLE_MANAGE: "role:manage",
};

/**
 * Profil d'écran (« admin » | « practitioner » | « viewer ») : le rôle système
 * s'il en est un, sinon une approximation par les permissions (rôles
 * personnalisés). Sert à choisir les indicateurs et textes d'accueil.
 */
export function screenProfile(user) {
  const perms = user?.permissions ?? [];
  if (user?.role === SystemRole.ADMIN || perms.includes(Permission.USER_MANAGE)) return "admin";
  if (user?.role === SystemRole.VIEWER || !perms.includes(Permission.ANALYSIS_CREATE)) return "viewer";
  return "practitioner";
}
