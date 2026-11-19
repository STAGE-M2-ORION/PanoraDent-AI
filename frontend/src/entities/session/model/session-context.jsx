import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { setSessionExpiredHandler } from "@/shared/api";

import { fetchMe, requestLogout } from "../api/session-api";

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
      logout,
      setUser,
      can: (code) => permissions.includes(code),
      canAny: (codes) => codes.some((code) => permissions.includes(code)),
    };
  }, [state, logout, setUser]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * Utilisateur courant : `{ status, user, endReason, logout, setUser, can, canAny }`,
 * avec `user = { email, nom, prenom, fullName, role, roleId, permissions, … }`
 * (null hors session). Il n'y a pas de `login` : la connexion est une
 * navigation vers Google (`startGoogleSignIn`).
 */
export function useCurrentUser() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useCurrentUser doit être utilisé sous <SessionProvider>.");
  return context;
}
