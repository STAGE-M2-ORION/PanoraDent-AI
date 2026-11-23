import { useCallback, useEffect, useRef, useState } from "react";

import { toAppError } from "@/shared/api";

import { fetchReportDownload, fetchReportPreview } from "../api/report-api";

const DELAI_APERCU_MS = 350; // regroupe les clics successifs sur les options

/**
 * Aperçu du compte rendu, demandé au serveur, régénéré quand les options
 * changent. `url` est une URL locale (blob:) du PDF, libérée au remplacement
 * et au démontage. `enabled` : ne rien demander (lecteur, analyse non terminée).
 */
export function useReportPreview(analysisId, options, { draft = false, enabled = true } = {}) {
  const [state, setState] = useState({ url: null, isPending: false, error: null });
  const urlRef = useRef(null);
  const key = JSON.stringify(options);

  const release = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };

  useEffect(() => {
    if (!analysisId || !enabled) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, isPending: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const { blob } = await fetchReportPreview(analysisId, JSON.parse(key), { draft });
        if (cancelled) return;
        release();
        urlRef.current = URL.createObjectURL(blob);
        setState({ url: urlRef.current, isPending: false, error: null });
      } catch (cause) {
        if (!cancelled) setState({ url: null, isPending: false, error: toAppError(cause) });
      }
    }, DELAI_APERCU_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [analysisId, key, draft, enabled]);

  useEffect(() => release, []);
  return state;
}

/** Téléchargement du compte rendu définitif : le fichier, sous le nom donné par le serveur. */
export function useReportDownload(analysisId) {
  const [state, setState] = useState({ isPending: false, error: null });
  const download = useCallback(
    async (options) => {
      setState({ isPending: true, error: null });
      try {
        const { blob, fileName } = await fetchReportDownload(analysisId, options);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setState({ isPending: false, error: null });
        return fileName;
      } catch (cause) {
        setState({ isPending: false, error: toAppError(cause) });
        return null;
      }
    },
    [analysisId],
  );
  return { download, ...state };
}
