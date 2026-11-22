import { useCallback, useEffect, useRef, useState } from "react";

import { toAppError } from "@/shared/api";

import { fetchAnalysisStatus, launchAnalysis } from "../api/analysis-api";
import { Processing } from "./analysis";

export const POLL_MS = 2000;

const isActive = (p) => p === Processing.QUEUED || p === Processing.RUNNING;

/**
 * Suivi d'une analyse dans la file : le statut est relu toutes les deux
 * secondes tant qu'elle est en file ou en cours (plus simple qu'une connexion
 * maintenue, et largement suffisant pour une inférence de quelques secondes),
 * puis le suivi s'arrête. `relaunch()` la remet en file après un échec.
 *
 * `initial` : statut déjà connu (réponse de la confirmation), pour ne pas
 * attendre la première lecture.
 */
export function useAnalysisProgress(id, { initial = null, enabled = true } = {}) {
  const [progress, setProgress] = useState(initial);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    setProgress(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id || !enabled) return undefined;
    if (progress && !isActive(progress.processing)) return undefined;
    let cancelled = false;
    const read = async () => {
      try {
        const next = await fetchAnalysisStatus(id);
        if (cancelled) return;
        setError(null);
        setProgress(next);
      } catch (cause) {
        if (!cancelled) setError(toAppError(cause));
      }
      if (!cancelled) setTick((t) => t + 1);
    };
    timer.current = setTimeout(read, progress ? POLL_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
    };
  }, [id, enabled, progress, tick]);

  const relaunch = useCallback(async () => {
    const next = await launchAnalysis(id);
    setProgress(next);
    return next;
  }, [id]);

  return { progress, error, relaunch, active: progress ? isActive(progress.processing) : Boolean(id) };
}
