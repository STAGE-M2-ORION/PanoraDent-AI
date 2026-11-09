import { httpClient } from "@/shared/api";

export function normalizeManagedUser(dto) {
  return {
    id: dto.id,
    email: dto.email,
    fullName: dto.full_name ?? "",
    isActive: dto.is_active,
    roleId: dto.role_id,
    role: dto.role,
    lastLoginAt: dto.last_login_at ? new Date(`${dto.last_login_at}Z`) : null,
  };
}

/** `GET /api/users` (permission `user:manage`). */
export async function fetchUsers() {
  const { data } = await httpClient.get("/users");
  return data.map(normalizeManagedUser);
}

/** `POST /api/users` — pas d'inscription publique : réservé aux administrateurs. */
export async function createUser({ email, password, fullName, roleId }) {
  const { data } = await httpClient.post("/users", {
    email,
    password,
    full_name: fullName,
    role_id: roleId,
  });
  return normalizeManagedUser(data);
}

/** `PATCH /api/users/{id}` — `{ isActive?, roleId?, fullName? }`. */
export async function updateUser(userId, { isActive, roleId, fullName }) {
  const patch = {};
  if (isActive !== undefined) patch.is_active = isActive;
  if (roleId !== undefined) patch.role_id = roleId;
  if (fullName !== undefined) patch.full_name = fullName;
  const { data } = await httpClient.patch(`/users/${userId}`, patch);
  return normalizeManagedUser(data);
}

/** `DELETE /api/users/{id}` — refusé pour soi-même et pour le dernier admin. */
export async function deleteUser(userId) {
  await httpClient.delete(`/users/${userId}`);
}
