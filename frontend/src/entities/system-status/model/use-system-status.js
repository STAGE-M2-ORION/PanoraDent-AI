import { useEffect, useState } from "react";

import { fetchSystemStatus } from "../api/health-api";
import { OFFLINE_STATUS } from "./system-status";

/** Intervalle entre deux lectures de `/api/health`, en millisecondes. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Interroge `/api/health` au montage, puis à intervalle régulier. Un échec n'est
 * pas une erreur bloquante : on retombe sur `OFFLINE_STATUS`, que le bandeau sait
 * afficher — et la lecture suivante le remet au vert dès que le backend répond
 * de nouveau (migrations terminées, service redémarré), sans recharger la page.
 *
 * Le sondage est suspendu quand l'onglet passe en arrière-plan et relancé au
 * retour : inutile d'interroger l'API sans personne pour lire le bandeau, et
 * l'état affiché doit être frais à l'instant où il redevient visible.
 */
export function useSystemStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const read = () =>
      fetchSystemStatus()
        .then((value) => {
          if (!cancelled) setStatus(value);
        })
        .catch(() => {
          if (!cancelled) setStatus(OFFLINE_STATUS);
        });

    const start = () => {
      if (timer === null) timer = setInterval(read, POLL_INTERVAL_MS);
    };

    const stop = () => {
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }
      read();
      start();
    };

    read();
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return status;
}
