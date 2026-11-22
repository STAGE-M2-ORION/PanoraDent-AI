import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { canReplay, fetchComparison, replayAnalysis } from "@/entities/analysis";
import { detectionLabelText } from "@/entities/detection";
import { activeVersion, fetchModelVersions } from "@/entities/model-version";
import { toAppError } from "@/shared/api";
import { useAsyncResource } from "@/shared/lib";
import { Alert, Button, Icon, Modal } from "@/shared/ui";

/**
 * Registre des modèles, côté poste de lecture :
 * - « Rejouer avec <version> » : nouvelle analyse du même cliché avec le modèle
 *   actif ; celle-ci reste telle quelle (même clôturée) ;
 * - sur un rejeu, « Comparer » : propositions des deux modèles, classe par classe.
 */
export function ModelReplay({ vm, canCreate }) {
  const router = useRouter();
  const { data: versions } = useAsyncResource(fetchModelVersions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const active = activeVersion(versions);

  if (!vm || vm.demo) return null;

  const replay = async () => {
    setBusy(true);
    setError(null);
    try {
      const copy = await replayAnalysis(vm.id);
      await router.push(`/analyse?id=${encodeURIComponent(copy.id)}`);
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {vm.originId ? (
        <button type="button" className="vbtn outline" onClick={() => setOpen(true)}>
          <Icon name="chart" />
          Comparer avec l’analyse d’origine
        </button>
      ) : null}
      {canCreate && canReplay(vm, active) ? (
        <button type="button" className="vbtn outline" onClick={replay} disabled={busy} title="Nouvelle analyse du même cliché avec le modèle actif ; celle-ci reste inchangée">
          <Icon name="refresh" />
          {busy ? "Rejeu…" : `Rejouer avec ${active.version}`}
        </button>
      ) : null}
      {error ? (
        <span role="alert" style={{ color: "#FCA5A5" }}>
          {error}
        </span>
      ) : null}
      {open ? <ComparisonModal analysisId={vm.id} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ComparisonModal({ analysisId, onClose }) {
  const [state, setState] = useState({ data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchComparison(analysisId)
      .then((data) => !cancelled && setState({ data, error: null }))
      .catch((cause) => !cancelled && setState({ data: null, error: toAppError(cause).message }));
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  const c = state.data;
  return (
    <Modal open onClose={onClose} labelledBy="cmp-t" wide>
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <h2 id="cmp-t">Comparaison des deux modèles</h2>
        {state.error ? (
          <Alert tone="danger" role="alert">
            {state.error}
          </Alert>
        ) : null}
        {c ? (
          <>
            <p>
              Même cliché, analysé par <span className="mono">{c.origin.modelVersion || "—"}</span> ({c.origin.ref}) puis par{" "}
              <span className="mono">{c.replay.modelVersion || "—"}</span> ({c.replay.ref}). Propositions des modèles à partir de{" "}
              {Math.round(c.threshold * 100)} % de confiance, avant tout verdict du praticien. Deux propositions se correspondent
              si elles ont la même classe et se recouvrent à au moins 50 %.
            </p>
            {c.rows ? (
              <div className="table-wrap">
                <table className="table stack" data-comparaison>
                  <caption className="sr-only">Propositions des deux modèles, par classe</caption>
                  <thead>
                    <tr>
                      <th scope="col">Classe</th>
                      <th scope="col">Ancien modèle</th>
                      <th scope="col">Nouveau modèle</th>
                      <th scope="col">Communes</th>
                      <th scope="col">Vues seulement par l’ancien</th>
                      <th scope="col">Vues seulement par le nouveau</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.rows.map((r) => (
                      <tr key={r.label}>
                        <th scope="row">{detectionLabelText(r.label)}</th>
                        <td className="mono">{r.before}</td>
                        <td className="mono">{r.after}</td>
                        <td className="mono">{r.common}</td>
                        <td className="mono">{r.onlyBefore}</td>
                        <td className="mono">{r.onlyAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Alert tone="info">Le rejeu n’est pas encore terminé : la comparaison apparaîtra à la fin de l’analyse.</Alert>
            )}
          </>
        ) : null}
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
}
