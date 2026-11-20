import { useEffect, useRef, useState } from "react";

import { Processing, useAnalysisProgress } from "@/entities/analysis";
import { toAppError } from "@/shared/api";
import { Icon } from "@/shared/ui";

/**
 * Analyse ouverte avant la fin du traitement : suivi de la file (relu toutes
 * les 2 s) puis rechargement de l'espace de lecture ; en cas d'échec, motif et
 * relance, sans réimporter l'image.
 */
export function ProcessingState({ vm, canLaunch, onDone }) {
  const { progress, relaunch } = useAnalysisProgress(vm.id, {
    initial: { processing: vm.processing, error: vm.error, position: null },
  });
  const [busy, setBusy] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const processing = progress?.processing ?? vm.processing;

  const doneSent = useRef(false);
  useEffect(() => {
    if (processing !== Processing.DONE || doneSent.current) return;
    doneSent.current = true;
    onDone();
  }, [processing, onDone]);

  const retry = async () => {
    setBusy(true);
    setLaunchError("");
    try {
      await relaunch();
    } catch (cause) {
      setLaunchError(toAppError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  const failed = processing === Processing.FAILED;
  return (
    <div className="processing-state" data-etat={failed ? "echec" : processing === Processing.QUEUED ? "en-file" : "en-cours"}>
      <div role={failed ? "alert" : "status"} aria-live="polite" style={{ maxWidth: 460, textAlign: "center", display: "grid", gap: 12, justifyItems: "center", padding: "var(--space-6)" }}>
        <Icon name={failed ? "alert" : "clock"} />
        {failed ? (
          <>
            <h2 style={{ fontSize: "var(--text-xl)" }}>L&apos;analyse a échoué</h2>
            <p style={{ color: "var(--color-viewer-muted)", fontSize: "var(--text-sm)" }}>
              {progress?.error || vm.error} L&apos;image anonymisée est conservée : la relance ne demande pas de réimporter.
            </p>
            {launchError ? <p style={{ color: "#FCA5A5", fontSize: "var(--text-sm)" }}>{launchError}</p> : null}
            {canLaunch ? (
              <button type="button" className="vbtn accent" onClick={retry} disabled={busy}>
                <Icon name="refresh" />
                {busy ? "Relance…" : "Relancer l’analyse"}
              </button>
            ) : null}
          </>
        ) : (
          <>
            <h2 style={{ fontSize: "var(--text-xl)" }}>{processing === Processing.QUEUED ? "Analyse en file d’attente" : "Analyse par le modèle en cours…"}</h2>
            <p style={{ color: "var(--color-viewer-muted)", fontSize: "var(--text-sm)" }}>
              {processing === Processing.QUEUED && progress?.position
                ? `${progress.position} analyse${progress.position > 1 ? "s" : ""} avant celle-ci. `
                : ""}
              Les résultats s&apos;afficheront ici dès qu&apos;ils seront prêts.
            </p>
            <span className="progress indeterminate" aria-hidden="true" style={{ width: 240 }}>
              <span />
            </span>
          </>
        )}
      </div>
    </div>
  );
}
