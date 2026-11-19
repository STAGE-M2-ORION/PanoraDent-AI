/**
 * Libellés des rôles système (cf. backend). Les autres rôles sont
 * personnalisés : leur libellé est choisi par l'administrateur.
 */
export const SystemRole = {
  ADMIN: "Administrateur",
  PRACTITIONER: "Praticien",
  VIEWER: "Lecteur",
};

/** Ordre d'affichage des rôles système. */
export const SYSTEM_ROLE_ORDER = [SystemRole.ADMIN, SystemRole.PRACTITIONER, SystemRole.VIEWER];

/** Libellé affiché d'un rôle : le backend renvoie déjà le libellé français. */
export function roleLabel(role) {
  return (typeof role === "string" ? role : role?.libelle) || "—";
}

/** Nom affiché d'un utilisateur : « Prénom Nom », à défaut l'e-mail. */
export function displayName(user) {
  return user?.fullName?.trim() || user?.email || "";
}

/** Codes de permission (cf. backend). */
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
 * Profil d'écran (« admin » | « practitioner » | « viewer »), déduit des
 * PERMISSIONS seules : rôles système et rôles personnalisés sont traités de la
 * même façon. Sert à choisir les indicateurs et textes d'accueil.
 */
export function screenProfile(user) {
  const perms = user?.permissions ?? [];
  if (perms.includes(Permission.USER_MANAGE)) return "admin";
  if (perms.includes(Permission.ANALYSIS_CREATE)) return "practitioner";
  return "viewer";
}

/**
 * Page d'arrivée après connexion : l'administration pour qui gère les comptes,
 * le tableau de bord pour les autres. Cosmétique : le serveur fait foi.
 */
export function homePathFor(user) {
  return user?.permissions?.includes(Permission.USER_MANAGE) ? "/admin" : "/tableau-de-bord";
}
