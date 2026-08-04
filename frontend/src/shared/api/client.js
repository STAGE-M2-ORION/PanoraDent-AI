import axios from "axios";

import { API_BASE_URL, API_TIMEOUT_MS } from "@/shared/config";

/**
 * Unique point de sortie HTTP de l'application. Aucune couche au-dessus de
 * `shared/api` ne doit instancier son propre client.
 */
export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
});
