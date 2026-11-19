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
 * administrateurs. Aucun mot de passe : la personne se connecte avec le compte
 * Google de cette adresse. `nom` et `prenom` peuvent rester vides : le backend
 * les reprend de Google à la première connexion.
 * Erreurs : 409 `adresse_deja_prise`, 422 `champ_invalide`.
 */
export async function createUser({ email, nom = "", prenom = "", roleId }) {
  const { data } = await httpClient.post("/utilisateurs", { email, nom, prenom, role_id: roleId });
  return normalizeManagedUser(data);
}

/**
 * `PATCH /api/v1/utilisateurs/{id}` — `{ nom?, prenom?, roleId?, isActive? }`.
 * Il n'y a pas de suppression : on désactive. Erreur 400
 * `dernier_administrateur` si l'on retire le dernier administrateur actif.
 */
export async function updateUser(userId, { nom, prenom, roleId, isActive }) {
  const patch = {};
  if (nom !== undefined) patch.nom = nom;
  if (prenom !== undefined) patch.prenom = prenom;
  if (roleId !== undefined) patch.role_id = roleId;
  if (isActive !== undefined) patch.statut = isActive ? "actif" : "desactive";
  const { data } = await httpClient.patch(`/utilisateurs/${userId}`, patch);
  return normalizeManagedUser(data);
}
