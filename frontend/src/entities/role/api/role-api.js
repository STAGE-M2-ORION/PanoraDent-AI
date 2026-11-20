import { httpClient } from "@/shared/api";

/** DTO `{ id, libelle, description, systeme, permissions, nb_utilisateurs }` → modèle. */
export function normalizeRole(dto) {
  return {
    id: dto.id,
    name: dto.libelle ?? "",
    description: dto.description ?? "",
    isSystem: Boolean(dto.systeme),
    permissions: dto.permissions ?? [],
    userCount: dto.nb_utilisateurs ?? 0,
  };
}

/** `GET /api/v1/roles` (permission `role:manage` ou `user:manage`). */
export async function fetchRoles() {
  const { data } = await httpClient.get("/roles");
  return data.map(normalizeRole);
}

/** `GET /api/v1/permissions` — catalogue `[{ code, libelle }]` (`role:manage` ou `user:manage`). */
export async function fetchPermissions() {
  const { data } = await httpClient.get("/permissions");
  return data.map((p) => ({ code: p.code, label: p.libelle ?? p.code }));
}

/** `POST /api/v1/roles` — `{ libelle, description, permissions }`. 409 si le nom est pris. */
export async function createRole({ name, description = "", permissions }) {
  const { data } = await httpClient.post("/roles", { libelle: name, description, permissions });
  return normalizeRole(data);
}

/**
 * `PATCH /api/v1/roles/{id}` — rôles personnalisés seulement (les rôles
 * système sont refusés : `role_systeme`). `permissions`, s'il est fourni,
 * REMPLACE l'ensemble des permissions du rôle.
 */
export async function updateRole(roleId, { name, description, permissions }) {
  const patch = {};
  if (name !== undefined) patch.libelle = name;
  if (description !== undefined) patch.description = description;
  if (permissions !== undefined) patch.permissions = permissions;
  const { data } = await httpClient.patch(`/roles/${roleId}`, patch);
  return normalizeRole(data);
}

/** `POST /api/v1/roles/{id}/dupliquer` — copie personnalisée (« Copie de X » sans nom). */
export async function duplicateRole(roleId, name) {
  const { data } = await httpClient.post(`/roles/${roleId}/dupliquer`, name ? { libelle: name } : {});
  return normalizeRole(data);
}

export async function deleteRole(roleId) {
  await httpClient.delete(`/roles/${roleId}`);
}
