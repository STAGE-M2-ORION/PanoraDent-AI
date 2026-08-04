import { useEffect, useState } from "react";

import { fetchSystemStatus } from "../api/health-api";
import { OFFLINE_STATUS } from "./system-status";

/**
 * Interroge `/api/health` au montage. Un échec n'est pas une erreur bloquante :
 * on retombe sur `OFFLINE_STATUS`, que le bandeau sait afficher.
 */
export function useSystemStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;

    fetchSystemStatus()
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch(() => {
        if (!cancelled) setStatus(OFFLINE_STATUS);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
