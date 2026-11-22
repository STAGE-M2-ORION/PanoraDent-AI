import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { httpClient, setSessionExpiredHandler } from "./client";

/**
 * On remplace le transport d'axios (adaptateur) : aucune requête réseau, mais
 * tout le reste — intercepteurs, rejeu, partage du rafraîchissement — tourne
 * pour de vrai.
 */
function reply(config, status, data = {}) {
  const response = { status, data, headers: {}, config, statusText: String(status) };
  if (status >= 400) {
    const error = new Error(`HTTP ${status}`);
    error.response = response;
    error.config = config;
    return Promise.reject(error);
  }
  return Promise.resolve(response);
}

describe("client HTTP unique", () => {
  let calls;
  let sessionValid;
  let refreshOk;
  const original = { client: httpClient.defaults.adapter, bare: axios.defaults.adapter };

  beforeEach(() => {
    calls = [];
    sessionValid = false;
    refreshOk = true;
    const adapter = async (config) => {
      const path = config.url.replace(/^.*\/api\/v1/, "");
      calls.push(path);
      if (path === "/auth/rafraichir") {
        await new Promise((r) => setTimeout(r, 5));
        if (!refreshOk) return reply(config, 401, { code: "session_expiree" });
        sessionValid = true;
        return reply(config, 204);
      }
      if (path === "/auth/connexion") return reply(config, 401, { code: "identifiants_invalides", message: "Adresse e-mail ou mot de passe incorrect." });
      return sessionValid ? reply(config, 200, { ok: path }) : reply(config, 401, { code: "non_authentifie" });
    };
    httpClient.defaults.adapter = adapter;
    axios.defaults.adapter = adapter;
  });

  afterEach(() => {
    httpClient.defaults.adapter = original.client;
    axios.defaults.adapter = original.bare;
    setSessionExpiredHandler(null);
  });

  it("accès expiré : rafraîchit une fois puis rejoue la requête", async () => {
    const { data } = await httpClient.get("/moi");
    expect(data).toEqual({ ok: "/moi" });
    expect(calls).toEqual(["/moi", "/auth/rafraichir", "/moi"]);
  });

  it("plusieurs 401 simultanés : un seul rafraîchissement partagé", async () => {
    await Promise.all([httpClient.get("/moi"), httpClient.get("/analyses"), httpClient.get("/roles")]);
    expect(calls.filter((c) => c === "/auth/rafraichir")).toHaveLength(1);
    expect(calls.filter((c) => c !== "/auth/rafraichir")).toHaveLength(6);
  });

  it("rafraîchissement refusé : la couche session est prévenue, l'erreur remonte", async () => {
    refreshOk = false;
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    await expect(httpClient.get("/moi")).rejects.toMatchObject({ response: { status: 401 } });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["/moi", "/auth/rafraichir"]);
  });

  it("jamais de rafraîchissement sur un refus d'identifiants", async () => {
    await expect(httpClient.post("/auth/connexion", {})).rejects.toMatchObject({ response: { status: 401 } });
    expect(calls).toEqual(["/auth/connexion"]);
  });

  it("une seule relance par requête, même si le rejeu échoue encore", async () => {
    // Le rafraîchissement « réussit » mais la session reste refusée.
    axios.defaults.adapter = async (config) => {
      calls.push("/auth/rafraichir");
      return reply(config, 204);
    };
    await expect(httpClient.get("/moi")).rejects.toMatchObject({ response: { status: 401 } });
    expect(calls).toEqual(["/moi", "/auth/rafraichir", "/moi"]);
  });

  it("envoie les cookies (withCredentials) et n'expose aucun jeton", () => {
    expect(httpClient.defaults.withCredentials).toBe(true);
    expect(httpClient.defaults.headers.common?.Authorization).toBeUndefined();
  });
});
