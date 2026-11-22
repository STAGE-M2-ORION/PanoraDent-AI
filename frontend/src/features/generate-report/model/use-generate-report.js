import { useCallback, useEffect, useState } from "react";

import { useAsyncAction } from "@/shared/lib";

import { requestReport } from "../api/report-api";

/** Génération du rapport PDF d'une analyse, et URL du dernier rapport produit. */
export function useGenerateReport(analysisId) {
  const [reportUrl, setReportUrl] = useState(null);
  const { run, reset, isPending, error } = useAsyncAction(requestReport);

  // Changer d'analyse invalide le rapport affiché.
  useEffect(() => {
    setReportUrl(null);
    reset();
  }, [analysisId, reset]);

  const generate = useCallback(async () => {
    const url = await run(analysisId);
    if (url) setReportUrl(url);
    return url;
  }, [run, analysisId]);

  return { generate, reportUrl, isPending, error };
}
