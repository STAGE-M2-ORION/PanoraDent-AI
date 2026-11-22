import axios from "axios";

import { API_BASE_URL, API_TIMEOUT_MS } from "@/shared/config";

/**
 * Unique point de sortie HTTP de l'application. Aucune couche au-dessus de
 * `shared/api` ne doit instancier son propre client.
 *
 * SESSION PAR COOKIES : le backend pose deux cookies `httpOnly` (accès 15 min,
 * rafraîchissement 7 j). Le JavaScript ne voit, ne stocke et n'envoie aucun
 * jeton : `withCredentials` suffit, et nginx sert l'API sur la même origine.
 *
 * Option par requête (champ de config axios) :
 * - `skipRefresh: true` — sur 401, ne tente aucun rafraîchissement (routes
 *   publiques, routes d'authentification elles-mêmes).
 */
export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  withCredentials: true,
});

/**
 * Routes dont un 401 ne doit jamais déclencher de rafraîchissement : le
 * rafraîchissement lui-même (boucle), la déconnexion, et les routes qui
 * OUVRENT une session — un 401 y veut dire « identifiants refusés », pas
 * « session expirée ».
 */
const AUTH_PATHS = [
  "/auth/rafraichir",
  "/auth/deconnexion",
  "/auth/connexion",
  "/auth/mot-de-passe/",
  "/auth/premiere-connexion",
];

let onSessionExpired = () => {};

/** Branché par la couche session : appelé quand le rafraîchissement échoue. */
export function setSessionExpiredHandler(handler) {
  onSessionExpired = typeof handler === "function" ? handler : () => {};
}

/**
 * Rafraîchissement partagé : si plusieurs requêtes reçoivent un 401 en même
 * temps, une seule appelle `/auth/rafraichir`, puis chacune est rejouée une
 * fois. Si le rafraîchissement échoue, `onSessionExpired` prévient la couche
 * session, et la garde de route renvoie vers `/connexion`.
 */
let refreshInFlight = null;

function refreshSession() {
  if (!refreshInFlight) {
    // Instance nue : ni l'intercepteur ci-dessous, ni risque de boucle.
    refreshInFlight = axios
      .post(`${API_BASE_URL}/auth/rafraichir`, null, { timeout: API_TIMEOUT_MS, withCredentials: true })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

httpClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error;
    if (
      response?.status !== 401 ||
      !config ||
      config.skipRefresh ||
      config._retried ||
      AUTH_PATHS.some((path) => config.url?.startsWith(path))
    ) {
      return Promise.reject(error);
    }

    // Une seule relance par requête.
    config._retried = true;
    try {
      await refreshSession();
    } catch {
      onSessionExpired();
      return Promise.reject(error);
    }
    return httpClient(config);
  },
);
