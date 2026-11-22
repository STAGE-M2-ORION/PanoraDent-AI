import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { setSessionExpiredHandler } from "@/shared/api";

import { fetchMe, loginWithPassword, requestLogout } from "../api/session-api";

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
 * Détient la session pour toute l'application. La session vit dans des
 * cookies `httpOnly` invisibles du JavaScript : au montage, on demande
 * simplement `GET /moi` — le client HTTP tente seul un rafraîchissement sur
 * 401. Réponse → `authenticated`, échec → `anonymous`.
 */
export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: SessionStatus.LOADING, user: null, endReason: null });
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  const setAnonymous = useCallback(
    (endReason = null) => setState({ status: SessionStatus.ANONYMOUS, user: null, endReason }),
    [],
  );

  useEffect(() => {
    // Rafraîchissement impossible en cours de route : la garde de route renvoie
    // vers /connexion, qui annonce l'expiration. Au démarrage (pas encore de
    // session connue), ce n'est pas une expiration : simple visiteur anonyme.
    setSessionExpiredHandler(() => {
      if (statusRef.current === SessionStatus.AUTHENTICATED) setAnonymous(SessionEndReason.EXPIRED);
    });

    let cancelled = false;
    fetchMe()
      .then((user) => {
        if (!cancelled) setState({ status: SessionStatus.AUTHENTICATED, user, endReason: null });
      })
      .catch(() => {
        if (!cancelled) setAnonymous();
      });
    return () => {
      cancelled = true;
      setSessionExpiredHandler(null);
    };
  }, [setAnonymous]);

  /**
   * Connexion par mot de passe. Les erreurs (401, 423, 403) remontent telles
   * quelles à l'écran de connexion, qui les affiche.
   */
  const login = useCallback(async (email, password) => {
    const user = await loginWithPassword(email, password);
    setState({ status: SessionStatus.AUTHENTICATED, user, endReason: null });
    return user;
  }, []);

  /**
   * Relit `/moi` : après une première connexion ou une réinitialisation, le
   * serveur a déjà posé les cookies de session ; on charge l'utilisateur.
   */
  const reload = useCallback(async () => {
    const user = await fetchMe();
    setState({ status: SessionStatus.AUTHENTICATED, user, endReason: null });
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await requestLogout();
    } catch {
      /* le serveur répond toujours 204 ; en cas de panne réseau, on vide quand même le client */
    }
    setAnonymous(SessionEndReason.SIGNED_OUT);
  }, [setAnonymous]);

  /** Remplace le profil courant (après un changement de photo, par exemple). */
  const setUser = useCallback(
    (user) => setState((prev) => (prev.status === SessionStatus.AUTHENTICATED ? { ...prev, user } : prev)),
    [],
  );

  const value = useMemo(() => {
    const permissions = state.user?.permissions ?? [];
    return {
      ...state,
      login,
      reload,
      logout,
      setUser,
      can: (code) => permissions.includes(code),
      canAny: (codes) => codes.some((code) => permissions.includes(code)),
    };
  }, [state, login, reload, logout, setUser]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * Utilisateur courant : `{ status, user, endReason, login, reload, logout,
 * setUser, can, canAny }`, avec `user = { email, nom, prenom, fullName, role,
 * roleId, permissions, preferences, … }` (null hors session). La connexion
 * Google n'est pas un appel mais une navigation (`startGoogleSignIn`).
 */
export function useCurrentUser() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useCurrentUser doit être utilisé sous <SessionProvider>.");
  return context;
}
