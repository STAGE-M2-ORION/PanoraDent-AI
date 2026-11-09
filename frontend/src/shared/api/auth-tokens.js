/**
 * Stockage des jetons de session.
 *
 * CHOIX DE STOCKAGE (documenté, cf. README « Authentification ») :
 * le backend renvoie les jetons dans le corps JSON et le frontend est un export
 * statique servi par nginx, sans couche serveur capable de poser un cookie
 * `httpOnly`. On limite donc l'exposition ainsi :
 *
 * - le jeton d'accès (15 min) ne vit qu'EN MÉMOIRE : jamais écrit sur disque ;
 * - le jeton de rafraîchissement (7 j) vit dans `sessionStorage` : propre à
 *   l'onglet, effacé à sa fermeture, jamais partagé entre onglets. Il permet de
 *   survivre à un rechargement de page.
 *
 * Contrepartie assumée : un XSS pourrait lire le jeton de rafraîchissement.
 * Passer à des cookies `httpOnly; Secure; SameSite=Strict` posés par le backend
 * est l'évolution prévue avant toute mise en production.
 */
const REFRESH_KEY = "panoradent.refresh_token";

let accessToken = null;

function readRefresh() {
  try {
    return window.sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null; // stockage bloqué ou rendu côté serveur
  }
}

function writeRefresh(value) {
  try {
    if (value) window.sessionStorage.setItem(REFRESH_KEY, value);
    else window.sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    /* stockage indisponible : la session ne survivra pas au rechargement */
  }
}

export const getAccessToken = () => accessToken;
export const getRefreshToken = () => readRefresh();

/** Enregistre la paire renvoyée par `/auth/login` ou `/auth/refresh`. */
export function setTokens({ access_token: access, refresh_token: refresh }) {
  accessToken = access ?? null;
  writeRefresh(refresh ?? null);
}

export function clearTokens() {
  accessToken = null;
  writeRefresh(null);
}

let onSessionExpired = () => {};

/** Branché par la couche session : appelé quand le rafraîchissement échoue. */
export function setSessionExpiredHandler(handler) {
  onSessionExpired = typeof handler === "function" ? handler : () => {};
}

export const notifySessionExpired = () => onSessionExpired();
