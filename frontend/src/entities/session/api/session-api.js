import { httpClient } from "@/shared/api";
import { API_BASE_URL } from "@/shared/config";

/**
 * URL de départ de la connexion Google. On y NAVIGUE (jamais de fetch) : le
 * backend répond par une redirection 302 vers Google, puis Google revient sur
 * le backend, qui pose les cookies de session et renvoie vers l'application
 * (`/` en cas de succès, `/connexion?erreur=<code>` en cas d'échec).
 */
export const GOOGLE_SIGN_IN_URL = `${API_BASE_URL}/auth/google/demarrer`;

/**
 * Rattachement du compte Google depuis une session ouverte (profil, première
 * connexion). Même navigation ; le retour se fait sur
 * `/profil?onglet=securite&google=rattache` (ou `&erreur=<code>`).
 */
export const GOOGLE_LINK_URL = `${GOOGLE_SIGN_IN_URL}?rattacher=1`;

/** Quitte l'application pour la connexion Google (vraie navigation). */
export function startGoogleSignIn() {
  window.location.assign(GOOGLE_SIGN_IN_URL);
}

/**
 * `POST /api/v1/auth/connexion` — adresse e-mail et mot de passe. Succès :
 * cookies de session posés, utilisateur renvoyé. Refus : 401 neutre,
 * 423 verrouillé (`details.secondes_restantes`), 403 désactivé.
 */
export async function loginWithPassword(email, password) {
  const { data } = await httpClient.post("/auth/connexion", { email, mot_de_passe: password });
  return normalizeUser(data);
}

/** `POST /api/v1/auth/mot-de-passe/oubli` — répond toujours 204, compte connu ou non. */
export async function requestPasswordReset(email) {
  await httpClient.post("/auth/mot-de-passe/oubli", { email });
}

/** `POST /api/v1/auth/mot-de-passe/reinitialiser` — ouvre la session en cas de succès (204). */
export async function resetPassword(token, password) {
  await httpClient.post("/auth/mot-de-passe/reinitialiser", { jeton: token, nouveau: password });
}

/** `POST /api/v1/auth/premiere-connexion` — choix du premier mot de passe ; ouvre la session (204). */
export async function completeFirstLogin(token, password) {
  await httpClient.post("/auth/premiere-connexion", { jeton: token, mot_de_passe: password });
}

/** `PATCH /api/v1/moi` — identité et coordonnées ; `null` ou "" efface un champ. */
export async function updateMyProfile(fields) {
  const { data } = await httpClient.patch("/moi", fields);
  return normalizeUser(data);
}

/** `PATCH /api/v1/moi/preferences` — mise à jour partielle ; renvoie toutes les préférences. */
export async function updateMyPreferences(preferences) {
  const { data } = await httpClient.patch("/moi/preferences", preferences);
  return data;
}

/**
 * `POST /api/v1/moi/mot-de-passe` (204). `current` est omis pour un compte qui
 * n'a pas encore de mot de passe. Les autres sessions du compte sont fermées.
 */
export async function changeMyPassword(current, next) {
  await httpClient.post("/moi/mot-de-passe", current ? { ancien: current, nouveau: next } : { nouveau: next });
}

/** `GET /api/v1/moi/sessions` — sessions ouvertes, la plus récente d'abord. */
export async function fetchMySessions() {
  const { data } = await httpClient.get("/moi/sessions");
  return data.map((s) => ({
    id: s.id,
    agent: s.agent ?? "",
    ip: s.ip ?? "",
    createdAt: new Date(s.cree_le),
    expiresAt: new Date(s.expire_le),
    current: Boolean(s.courante),
  }));
}

/** `DELETE /api/v1/moi/sessions/{id}` (204) — révoquer la courante revient à se déconnecter. */
export async function revokeMySession(sessionId) {
  await httpClient.delete(`/moi/sessions/${sessionId}`);
}

/** `GET /api/v1/moi` — profil, rôle et permissions du compte connecté. 401 sans session. */
export async function fetchMe() {
  const { data } = await httpClient.get("/moi");
  return normalizeUser(data);
}

/**
 * `PUT /api/v1/moi/photo` — importe une photo de profil (JPEG, PNG ou WebP,
 * 2 Mo au plus). Le serveur la recadre en carré et la ré-encode ; elle passe
 * avant la photo Google. Renvoie l'utilisateur à jour.
 */
export async function uploadMyPhoto(file) {
  const body = new FormData();
  body.append("fichier", file);
  const { data } = await httpClient.put("/moi/photo", body);
  return normalizeUser(data);
}

/** `DELETE /api/v1/moi/photo` (204) — revient à la photo Google (ou aux initiales). */
export async function removeMyPhoto() {
  await httpClient.delete("/moi/photo");
  return fetchMe();
}

/** `POST /api/v1/auth/deconnexion` — révoque la session et efface les cookies (204). */
export async function requestLogout() {
  await httpClient.post("/auth/deconnexion", null, { skipRefresh: true });
}

/** Nom affiché : « Prénom Nom », à défaut l'adresse e-mail. */
function composeFullName(prenom, nom, email) {
  return [prenom, nom].map((part) => (part ?? "").trim()).filter(Boolean).join(" ") || email || "";
}

/**
 * DTO utilisateur du backend (`/moi`, `/utilisateurs`) → modèle de l'interface.
 * Les dates arrivent en ISO avec fuseau (timestamptz) : `new Date()` suffit.
 */
export function normalizeUser(dto) {
  const role = dto.role ?? {};
  return {
    id: dto.id,
    email: dto.email ?? "",
    nom: dto.nom ?? "",
    prenom: dto.prenom ?? "",
    fullName: composeFullName(dto.prenom, dto.nom, dto.email),
    isActive: Boolean(dto.actif),
    // Modes autorisés par l'administrateur, et ce qui est déjà en place.
    loginModes: dto.modes_connexion ?? [],
    hasPassword: Boolean(dto.mot_de_passe_defini),
    googleLinked: Boolean(dto.google_rattache),
    mustChangePassword: Boolean(dto.doit_changer_mdp),
    titre: dto.titre ?? null,
    specialite: dto.specialite ?? null,
    numeroOrdre: dto.numero_ordre ?? null,
    telephone: dto.telephone ?? null,
    preferences: dto.preferences ?? {},
    role: role.libelle ?? "",
    roleId: role.id ?? null,
    roleIsSystem: Boolean(role.systeme),
    permissions: dto.permissions ?? [],
    lastLoginAt: dto.derniere_connexion ? new Date(dto.derniere_connexion) : null,
    createdAt: dto.cree_le ? new Date(dto.cree_le) : null,
    // Photo importée, sinon photo du compte Google, sinon null (initiales).
    photoUrl: dto.photo_url ?? null,
    photoThumbUrl: dto.photo_miniature_url ?? dto.photo_url ?? null,
    photoSource: dto.photo_source ?? null, // "importee" | "google" | null
  };
}
