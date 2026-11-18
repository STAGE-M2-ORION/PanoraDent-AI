import { httpClient } from "@/shared/api";

/** `POST /api/auth/me/password` — change le mot de passe du compte connecté. */
export async function changeMyPassword(currentPassword, newPassword) {
  await httpClient.post("/auth/me/password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

/**
 * Demande d'un lien de réinitialisation par e-mail. Le backend n'expose pas
 * encore cette route : l'appel échoue (404) et l'écran le dit honnêtement.
 */
export async function requestPasswordReset(email) {
  await httpClient.post("/auth/password/forgot", { email }, { skipAuth: true });
}
