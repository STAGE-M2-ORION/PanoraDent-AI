import { useCallback, useEffect, useRef, useState } from "react";

import { toAppError } from "@/shared/api";

export const AsyncStatus = {
  IDLE: "idle",
  PENDING: "pending",
  SUCCESS: "success",
  ERROR: "error",
};

/**
 * Enveloppe une action asynchrone (upload, génération de rapport…) dans une
 * machine à états `idle → pending → success | error`.
 *
 * `run` ne rejette jamais : il renvoie la valeur produite, ou `undefined` si
 * l'action a échoué — l'erreur normalisée est alors disponible dans `error`.
 * Les mises à jour d'état sont ignorées après démontage.
 */
export function useAsyncAction(action) {
  const [status, setStatus] = useState(AsyncStatus.IDLE);
  const [error, setError] = useState(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args) => {
      setStatus(AsyncStatus.PENDING);
      setError(null);
      try {
        const result = await action(...args);
        if (isMounted.current) setStatus(AsyncStatus.SUCCESS);
        return result;
      } catch (cause) {
        if (isMounted.current) {
          setError(toAppError(cause));
          setStatus(AsyncStatus.ERROR);
        }
        return undefined;
      }
    },
    [action],
  );

  const reset = useCallback(() => {
    setStatus(AsyncStatus.IDLE);
    setError(null);
  }, []);

  return {
    run,
    reset,
    status,
    error,
    isPending: status === AsyncStatus.PENDING,
  };
}
