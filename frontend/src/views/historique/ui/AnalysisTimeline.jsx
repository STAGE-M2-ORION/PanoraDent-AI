import { useEffect, useState } from "react";

import { fetchAnalysisTimeline } from "@/entities/analysis";
import { toAppError } from "@/shared/api";
import { formatDateTime } from "@/shared/lib";
import { Alert, Button, Icon, Modal } from "@/shared/ui";

const ICONE = { verdict: "check", report: "file", event: "clock" };

/**
 * Fiche d'historique d'une analyse (sprint 8) : import, traitement, verdicts,
 * dents déclarées absentes, clôture, réouverture, comptes rendus — telle que
 * le serveur la lit dans le journal et la table des verdicts.
 */
export function AnalysisTimeline({ analysis, onClose }) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    if (!analysis) return undefined;
    let cancelled = false;
    setState({ data: null, error: null });
    fetchAnalysisTimeline(analysis.id)
      .then((data) => !cancelled && setState({ data, error: null }))
      .catch((cause) => !cancelled && setState({ data: null, error: toAppError(cause) }));
    return () => {
      cancelled = true;
    };
  }, [analysis]);

  const events = state.data?.events ?? [];
  return (
    <Modal open={Boolean(analysis)} onClose={onClose} labelledBy="fiche-title">
      <h2 id="fiche-title">
        Historique de l’analyse <span className="mono">{analysis?.ref ?? ""}</span>
      </h2>
      <p className="muted">Lu dans le journal d’audit et la liste des verdicts, qui ne sont jamais modifiés.</p>
      {state.error ? (
        <Alert tone="danger" role="alert">
          {state.error.message}
        </Alert>
      ) : null}
      {!state.data && !state.error ? <p className="muted">Chargement de l’historique…</p> : null}
      {state.data ? (
        <ol className="timeline" aria-label="Événements, du plus ancien au plus récent">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className={`tl-${e.kind}${e.cancelledAt ? " tl-cancelled" : ""}`} data-action={e.action}>
              <span className="tl-dot" aria-hidden="true">
                <Icon name={ICONE[e.kind]} />
              </span>
              <div>
                <p className="tl-head">
                  <b>{e.label}</b>
                  <span className="tl-when">{formatDateTime(e.at)}</span>
                </p>
                {e.detail ? <p className="tl-detail">{e.detail}</p> : null}
                <p className="tl-who">
                  {e.author ? `par ${e.author}` : "par la plateforme"}
                  {e.cancelledAt ? ` · annulé le ${formatDateTime(e.cancelledAt)}` : ""}
                </p>
              </div>
            </li>
          ))}
          {events.length === 0 ? <li className="muted">Aucun événement enregistré.</li> : null}
        </ol>
      ) : null}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </Modal>
  );
}
