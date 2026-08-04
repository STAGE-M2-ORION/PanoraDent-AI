/**
 * Configuration résolue à la compilation.
 *
 * `NEXT_PUBLIC_API_BASE` est inlinée par Next au moment du `npm run build` :
 * la définir au runtime du conteneur nginx n'a aucun effet. Derrière le proxy
 * nginx, la valeur par défaut `/api` est la bonne.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE || "/api";

/** Délai maximal d'un appel API, en millisecondes. */
export const API_TIMEOUT_MS = 120_000;
