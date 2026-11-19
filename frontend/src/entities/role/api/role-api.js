import { httpClient } from "@/shared/api";

/** DTO `{ id, libelle, systeme, permissions, nb_utilisateurs }` → modèle. */
export function normalizeRole(dto) {
  return {
    id: dto.id,
    name: dto.libelle ?? "",
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

/** `GET /api/v1/permissions` — catalogue `[{ code, libelle }]` des permissions assignables. */
export async function fetchPermissions() {
  const { data } = await httpClient.get("/permissions");
  return data.map((p) => ({ code: p.code, label: p.libelle ?? p.code }));
}

/** `POST /api/v1/roles` — `{ libelle, permissions }`. */
export async function createRole({ name, permissions }) {
  const { data } = await httpClient.post("/roles", { libelle: name, permissions });
  return normalizeRole(data);
}

/** `PATCH /api/v1/roles/{id}`. `permissions`, s'il est fourni, REMPLACE l'ensemble des permissions du rôle. */
export async function updateRole(roleId, { name, permissions }) {
  const patch = {};
  if (name !== undefined) patch.libelle = name;
  if (permissions !== undefined) patch.permissions = permissions;
  const { data } = await httpClient.patch(`/roles/${roleId}`, patch);
  return normalizeRole(data);
}

export async function deleteRole(roleId) {
  await httpClient.delete(`/roles/${roleId}`);
}
