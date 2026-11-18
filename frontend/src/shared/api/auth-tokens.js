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
 * - « Se souvenir de moi » (écran de connexion) place le jeton de
 *   rafraîchissement dans `localStorage` : la session survit alors à la
 *   fermeture de l'onglet, jusqu'à l'expiration du jeton (7 j) ou la
 *   déconnexion.
 *
 * Contrepartie assumée : un XSS pourrait lire le jeton de rafraîchissement.
 * Passer à des cookies `httpOnly; Secure; SameSite=Strict` posés par le backend
 * est l'évolution prévue avant toute mise en production.
 */
const REFRESH_KEY = "panoradent.refresh_token";

let accessToken = null;

function storages() {
  try {
    return { session: window.sessionStorage, local: window.localStorage };
  } catch {
    return null; // stockage bloqué ou rendu côté serveur
  }
}

function readRefresh() {
  const s = storages();
  if (!s) return null;
  try {
    return s.session.getItem(REFRESH_KEY) ?? s.local.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function writeRefresh(value, persist) {
  const s = storages();
  if (!s) return;
  try {
    s.session.removeItem(REFRESH_KEY);
    s.local.removeItem(REFRESH_KEY);
    if (value) (persist ? s.local : s.session).setItem(REFRESH_KEY, value);
  } catch {
    /* stockage indisponible : la session ne survivra pas au rechargement */
  }
}

/** La session courante a-t-elle été mémorisée (« Se souvenir de moi ») ? */
function isPersistent() {
  try {
    return window.localStorage.getItem(REFRESH_KEY) !== null;
  } catch {
    return false;
  }
}

export const getAccessToken = () => accessToken;
export const getRefreshToken = () => readRefresh();

/**
 * Enregistre la paire renvoyée par `/auth/login` ou `/auth/refresh`.
 * `persist` : mémoriser au-delà de l'onglet ; par défaut, on garde le choix fait
 * à la connexion (cas du rafraîchissement).
 */
export function setTokens({ access_token: access, refresh_token: refresh }, { persist } = {}) {
  accessToken = access ?? null;
  writeRefresh(refresh ?? null, persist ?? isPersistent());
}

export function clearTokens() {
  accessToken = null;
  writeRefresh(null, false);
}

let onSessionExpired = () => {};

/** Branché par la couche session : appelé quand le rafraîchissement échoue. */
export function setSessionExpiredHandler(handler) {
  onSessionExpired = typeof handler === "function" ? handler : () => {};
}

export const notifySessionExpired = () => onSessionExpired();
