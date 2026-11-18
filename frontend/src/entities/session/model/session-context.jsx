import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setSessionExpiredHandler,
  setTokens,
} from "@/shared/api";

import { fetchMe, requestLogin, requestLogout } from "../api/session-api";

export const SessionStatus = {
  LOADING: "loading",
  AUTHENTICATED: "authenticated",
  ANONYMOUS: "anonymous",
};

/** Pourquoi la session s'est terminée : la page de connexion l'annonce. */
export const SessionEndReason = {
  EXPIRED: "expiree",
  SIGNED_OUT: "deconnecte",
};

const SessionContext = createContext(null);

/**
 * Détient la session pour toute l'application. Au montage, si une session peut
 * exister (jeton de rafraîchissement dans l'onglet), on charge le profil : le
 * client HTTP rafraîchit seul le jeton d'accès au premier 401.
 */
export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: SessionStatus.LOADING, user: null, endReason: null });

  const setAnonymous = useCallback(
    (endReason = null) => setState({ status: SessionStatus.ANONYMOUS, user: null, endReason }),
    [],
  );

  useEffect(() => {
    // Rafraîchissement impossible en cours de route : la garde de route renvoie
    // vers /connexion, qui annonce l'expiration.
    setSessionExpiredHandler(() => setAnonymous(SessionEndReason.EXPIRED));

    let cancelled = false;
    if (!getAccessToken() && !getRefreshToken()) {
      setAnonymous();
    } else {
      fetchMe()
        .then((user) => {
          if (!cancelled) setState({ status: SessionStatus.AUTHENTICATED, user, endReason: null });
        })
        .catch(() => {
          if (!cancelled) {
            clearTokens();
            setAnonymous();
          }
        });
    }
    return () => {
      cancelled = true;
      setSessionExpiredHandler(null);
    };
  }, [setAnonymous]);

  const login = useCallback(async (email, password, { remember = false } = {}) => {
    const tokens = await requestLogin(email.trim(), password);
    setTokens(tokens, { persist: remember });
    try {
      const user = await fetchMe();
      setState({ status: SessionStatus.AUTHENTICATED, user, endReason: null });
      return user;
    } catch (error) {
      clearTokens();
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await requestLogout();
    } catch {
      /* session déjà expirée côté serveur : on vide quand même le client */
    }
    clearTokens();
    setAnonymous(SessionEndReason.SIGNED_OUT);
  }, [setAnonymous]);

  const value = useMemo(() => {
    const permissions = state.user?.permissions ?? [];
    return {
      ...state,
      login,
      logout,
      can: (code) => permissions.includes(code),
      canAny: (codes) => codes.some((code) => permissions.includes(code)),
    };
  }, [state, login, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * Utilisateur courant : `{ status, user, endReason, login, logout, can, canAny }`,
 * avec `user = { email, fullName, role, permissions, … }` (null hors session).
 */
export function useCurrentUser() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useCurrentUser doit être utilisé sous <SessionProvider>.");
  return context;
}
