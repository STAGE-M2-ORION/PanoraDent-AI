import { httpClient } from "@/shared/api";
import { API_BASE_URL } from "@/shared/config";

/**
 * URL de départ de la connexion Google. On y NAVIGUE (jamais de fetch) : le
 * backend répond par une redirection 302 vers Google, puis Google revient sur
 * le backend, qui pose les cookies de session et renvoie vers l'application
 * (`/` en cas de succès, `/connexion?erreur=<code>` en cas d'échec).
 */
export const GOOGLE_SIGN_IN_URL = `${API_BASE_URL}/auth/google/demarrer`;

/** Quitte l'application pour la connexion Google (vraie navigation). */
export function startGoogleSignIn() {
  window.location.assign(GOOGLE_SIGN_IN_URL);
}

/** `GET /api/v1/moi` — profil, rôle et permissions du compte connecté. 401 sans session. */
export async function fetchMe() {
  const { data } = await httpClient.get("/moi");
  return normalizeUser(data);
}

/**
 * `PUT /api/v1/moi/photo` — importe une photo de profil (JPEG, PNG ou WebP,
 * 5 Mo au plus). Le serveur la recadre en carré et la ré-encode ; elle passe
 * avant la photo Google. Renvoie l'utilisateur à jour.
 */
export async function uploadMyPhoto(file) {
  const body = new FormData();
  body.append("fichier", file);
  const { data } = await httpClient.put("/moi/photo", body);
  return normalizeUser(data);
}

/** `DELETE /api/v1/moi/photo` — revient à la photo Google (ou aux initiales). */
export async function removeMyPhoto() {
  const { data } = await httpClient.delete("/moi/photo");
  return normalizeUser(data);
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
    photoSource: dto.photo_source ?? null, // "importee" | "google" | null
  };
}
