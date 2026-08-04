import { useCallback } from "react";

import { createAnalysis } from "@/entities/analysis";
import { useAsyncAction } from "@/shared/lib";

/**
 * Import d'une panoramique. L'analyse produite est remontée via `onSuccess` :
 * la feature ne détient pas l'analyse courante, c'est le rôle de la page.
 */
export function useUploadAnalysis(onSuccess) {
  const { run, isPending, error } = useAsyncAction(createAnalysis);

  const upload = useCallback(
    async (file) => {
      const analysis = await run(file);
      if (analysis) onSuccess(analysis);
    },
    [run, onSuccess],
  );

  return { upload, isPending, error };
}
