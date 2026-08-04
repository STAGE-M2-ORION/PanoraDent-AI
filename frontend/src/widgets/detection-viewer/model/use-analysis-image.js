import { useEffect, useState } from "react";

import { fetchAnalysisImageUrl } from "@/entities/analysis";

export const ImageStatus = {
  LOADING: "loading",
  READY: "ready",
  UNAVAILABLE: "unavailable",
};

/**
 * Récupère l'URL présignée de l'image, puis la précharge.
 *
 * Le préchargement distingue deux échecs : l'API qui ne répond pas, et l'URL
 * présignée non résolvable depuis le navigateur — cas connu en développement,
 * où elle est signée avec l'hôte interne `minio:9000`.
 */
export function useAnalysisImage(analysisId) {
  const [image, setImage] = useState(null);
  const [status, setStatus] = useState(ImageStatus.LOADING);

  useEffect(() => {
    let cancelled = false;
    setImage(null);
    setStatus(ImageStatus.LOADING);

    fetchAnalysisImageUrl(analysisId)
      .then((url) => {
        if (cancelled) return;

        const element = new Image();
        element.crossOrigin = "anonymous";
        element.onload = () => {
          if (cancelled) return;
          setImage(element);
          setStatus(ImageStatus.READY);
        };
        element.onerror = () => {
          if (!cancelled) setStatus(ImageStatus.UNAVAILABLE);
        };
        element.src = url;
      })
      .catch(() => {
        if (!cancelled) setStatus(ImageStatus.UNAVAILABLE);
      });

    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  return { image, status };
}
