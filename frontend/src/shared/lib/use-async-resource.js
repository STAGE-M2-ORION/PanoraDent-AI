import { useCallback, useEffect, useState } from "react";

import { toAppError } from "@/shared/api";

/**
 * Charge une ressource asynchrone au montage et la recharge sur demande.
 * `fetcher` doit être une référence STABLE (fonction de module) : elle sert de
 * dépendance à l'effet.
 *
 * Renvoie `{ data, error, isLoading, reload, setData }`. `error` est une
 * `AppError` ; `setData` remplace la donnée par celle qu'une écriture vient
 * de renvoyer, sans nouvelle requête.
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
  const setData = useCallback((data) => setState({ data, error: null, isLoading: false }), []);
  return { ...state, reload, setData };
}
