import { useCallback, useEffect, useState } from "react";

import { toAppError } from "@/shared/api";

/**
 * Charge une ressource asynchrone au montage et la recharge sur demande.
 * `fetcher` doit être une référence STABLE (fonction de module) : elle sert de
 * dépendance à l'effet.
 *
 * Renvoie `{ data, error, isLoading, reload }`. `error` est une `AppError`.
 */
export function useAsyncResource(fetcher) {
  const [state, setState] = useState({ data: null, error: null, isLoading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, error: null, isLoading: true }));
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, isLoading: false });
      })
      .catch((cause) => {
        if (!cancelled) setState({ data: null, error: toAppError(cause), isLoading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
