import { httpClient } from "@/shared/api";

/**
 * `POST /api/auth/login` — corps `application/x-www-form-urlencoded`
 * (OAuth2 password flow) : le champ `username` porte l'email.
 * Renvoie `{ access_token, refresh_token, token_type }`.
 */
export async function requestLogin(email, password) {
  const body = new URLSearchParams({ username: email, password });
  const { data } = await httpClient.post("/auth/login", body, { skipAuth: true });
  return data;
}

/** `GET /api/auth/me` — profil, rôle et permissions de l'utilisateur courant. */
export async function fetchMe() {
  const { data } = await httpClient.get("/auth/me");
  return normalizeUser(data);
}

/** `POST /api/auth/logout` — révoque toutes les sessions de l'utilisateur. */
export async function requestLogout() {
  await httpClient.post("/auth/logout");
}

export function normalizeUser(dto) {
  return {
    id: dto.id,
    email: dto.email,
    fullName: dto.full_name ?? "",
    role: dto.role,
    permissions: dto.permissions ?? [],
    lastLoginAt: dto.last_login_at ?? null,
  };
}
