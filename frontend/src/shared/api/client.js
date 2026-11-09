import axios from "axios";

import { API_BASE_URL, API_TIMEOUT_MS } from "@/shared/config";

import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  notifySessionExpired,
  setTokens,
} from "./auth-tokens";

/**
 * Unique point de sortie HTTP de l'application. Aucune couche au-dessus de
 * `shared/api` ne doit instancier son propre client.
 *
 * Options par requête (champs de config axios) :
 * - `skipAuth: true`  — n'ajoute pas d'en-tête Authorization et ne tente
 *   aucun rafraîchissement (login, refresh).
 */
export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
});

httpClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token && !config.skipAuth) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Rafraîchissement partagé : si plusieurs requêtes reçoivent un 401 en même
 * temps, une seule appelle `/auth/refresh`. Indispensable car le serveur fait
 * tourner les jetons — un second appel avec l'ancien jeton serait refusé et
 * couperait la session.
 */
let refreshInFlight = null;

function refreshSession() {
  if (!refreshInFlight) {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return Promise.reject(new Error("no refresh token"));

    // Instance nue : ni cet intercepteur, ni risque de boucle.
    refreshInFlight = axios
      .post(
        `${API_BASE_URL}/auth/refresh`,
        { refresh_token: refreshToken },
        { timeout: API_TIMEOUT_MS },
      )
      .then(({ data }) => {
        setTokens(data);
        return data.access_token;
      })
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
    if (response?.status !== 401 || !config || config.skipAuth || config._retried) {
      return Promise.reject(error);
    }

    // Une seule relance par requête.
    config._retried = true;
    try {
      const token = await refreshSession();
      config.headers.Authorization = `Bearer ${token}`;
      return httpClient(config);
    } catch {
      clearTokens();
      notifySessionExpired();
      return Promise.reject(error);
    }
  },
);
