import { useEffect, useState } from "react";

import { fetchAnalyses, fetchAnalysis, fetchAnalysisImageUrl } from "@/entities/analysis";
import { toAppError } from "@/shared/api";

import { demoViewModel, realViewModel } from "./view-model";

/** Charge l'analyse réelle (`?id=`) ou construit la démonstration. */
export function useAnalysisViewModel(id, ready) {
  const [state, setState] = useState({ vm: null, loading: true, error: null });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!ready) return undefined;
    if (!id) {
      setState({ vm: demoViewModel(), loading: false, error: null });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([fetchAnalysis(id), fetchAnalysisImageUrl(id).catch(() => null), fetchAnalyses().catch(() => [])])
      .then(([analysis, imageUrl, list]) => {
        if (cancelled) return;
        const number = list.find((a) => a.id === id)?.number;
        setState({ vm: realViewModel(analysis, { imageUrl, number }), loading: false, error: null });
      })
      .catch((cause) => {
        if (!cancelled) setState({ vm: null, loading: false, error: toAppError(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [id, ready, version]);
  return { ...state, reload: () => setVersion((v) => v + 1) };
}

