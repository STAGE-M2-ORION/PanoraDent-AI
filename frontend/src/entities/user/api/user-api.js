import { normalizeUser } from "@/entities/session/@x/user";
import { httpClient } from "@/shared/api";

/** Même format que `/moi` : `{ id, email, nom, prenom, fullName, isActive, role, roleId, … }`. */
export const normalizeManagedUser = normalizeUser;

/** `GET /api/v1/utilisateurs` (permission `user:manage`). */
export async function fetchUsers() {
  const { data } = await httpClient.get("/utilisateurs");
  return data.map(normalizeManagedUser);
}

/**
 * `POST /api/v1/utilisateurs` — pas d'inscription publique : réservé aux
 * administrateurs, qui choisissent les modes de connexion autorisés
 * (`loginModes`). Le serveur envoie à la personne son lien de première
 * connexion (ou une invitation Google) ; l'administrateur ne choisit jamais le
 * mot de passe. `nom` et `prenom` vides sont repris de Google au rattachement.
 * Erreurs : 409 `adresse_deja_prise`, 422 `champ_invalide`.
 */
export async function createUser({ email, nom = "", prenom = "", roleId, loginModes = ["mot_de_passe", "google"] }) {
  const { data } = await httpClient.post("/utilisateurs", { email, nom, prenom, role_id: roleId, modes_connexion: loginModes });
  return normalizeManagedUser(data);
}

/**
 * `PATCH /api/v1/utilisateurs/{id}` — `{ nom?, prenom?, roleId?, isActive?,
 * loginModes?, reason? }`. Il n'y a pas de suppression : on désactive.
 * Erreurs : 422 `motif_requis` (désactivation ou changement de rôle sans
 * motif), 400 `dernier_administrateur`, 400 `action_sur_soi`.
 */
export async function updateUser(userId, { nom, prenom, roleId, isActive, loginModes, reason }) {
  const patch = {};
  if (nom !== undefined) patch.nom = nom;
  if (prenom !== undefined) patch.prenom = prenom;
  if (roleId !== undefined) patch.role_id = roleId;
  if (isActive !== undefined) patch.actif = Boolean(isActive);
  if (loginModes !== undefined) patch.modes_connexion = loginModes;
  if (reason) patch.motif = reason;
  const { data } = await httpClient.patch(`/utilisateurs/${userId}`, patch);
  return normalizeManagedUser(data);
}

/** `GET /api/v1/utilisateurs/{id}/sessions` — sessions ouvertes du compte. */
export async function fetchUserSessions(userId) {
  const { data } = await httpClient.get(`/utilisateurs/${userId}/sessions`);
  return data.map((s) => ({ id: s.id, agent: s.agent ?? "", ip: s.ip ?? "", createdAt: new Date(s.cree_le), expiresAt: new Date(s.expire_le) }));
}

/** `DELETE /api/v1/utilisateurs/{id}/sessions` — ferme toutes les sessions du compte. */
export async function revokeUserSessions(userId) {
  await httpClient.delete(`/utilisateurs/${userId}/sessions`);
}

/** `POST /api/v1/utilisateurs/{id}/renvoyer-lien` — nouveau lien de première connexion (ou invitation Google). */
export async function resendFirstLogin(userId) {
  await httpClient.post(`/utilisateurs/${userId}/renvoyer-lien`);
}

/**
 * `POST /api/v1/utilisateurs/{id}/reinitialiser-mot-de-passe` — ferme les
 * sessions, envoie un lien de réinitialisation, impose un nouveau mot de passe.
 */
export async function resetUserPassword(userId) {
  await httpClient.post(`/utilisateurs/${userId}/reinitialiser-mot-de-passe`);
}

/** `GET /api/v1/utilisateurs.csv` — liste des comptes, export journalisé. */
export async function exportUsersCsv() {
  const { data, headers } = await httpClient.get("/utilisateurs.csv", { responseType: "blob" });
  const m = /filename="?([^";]+)"?/i.exec(headers?.["content-disposition"] ?? "");
  return { blob: data, fileName: m ? m[1] : "comptes.csv" };
}

/** `POST /api/v1/utilisateurs/renvoyer-liens` — à tous les comptes actifs jamais connectés. */
export async function resendAllFirstLogins() {
  const { data } = await httpClient.post("/utilisateurs/renvoyer-liens");
  return { sent: data.envoyes, emails: data.comptes ?? [] };
}
