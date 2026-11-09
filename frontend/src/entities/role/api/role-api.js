import { httpClient } from "@/shared/api";

export function normalizeRole(dto) {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description ?? "",
    isSystem: dto.is_system,
    permissions: dto.permissions ?? [],
    userCount: dto.user_count ?? 0,
  };
}

/** `GET /api/roles` (permission `role:manage` ou `user:manage`). */
export async function fetchRoles() {
  const { data } = await httpClient.get("/roles");
  return data.map(normalizeRole);
}

/** `GET /api/permissions` — catalogue des permissions assignables. */
export async function fetchPermissions() {
  const { data } = await httpClient.get("/permissions");
  return data;
}

export async function createRole({ name, description, permissions }) {
  const { data } = await httpClient.post("/roles", { name, description, permissions });
  return normalizeRole(data);
}

/** `permissions`, s'il est fourni, REMPLACE l'ensemble des permissions du rôle. */
export async function updateRole(roleId, { name, description, permissions }) {
  const { data } = await httpClient.patch(`/roles/${roleId}`, { name, description, permissions });
  return normalizeRole(data);
}

export async function deleteRole(roleId) {
  await httpClient.delete(`/roles/${roleId}`);
}
