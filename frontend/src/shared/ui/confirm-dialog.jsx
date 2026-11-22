import { useEffect, useState } from "react";

import { Button } from "./button";
import { Alert, Modal } from "./feedback";

/**
 * Confirmation d'une action qui a des conséquences (désactiver un compte,
 * changer un rôle, supprimer un rôle, réinitialiser un accès).
 *
 * - `reason` : `"required"` | `"optional"` | absent — champ « Motif », inscrit
 *   au journal par le serveur ;
 * - `onConfirm(motif)` : promesse ; un refus du serveur s'affiche dans la
 *   fenêtre, qui reste ouverte ;
 * - `tone="danger"` : bouton de confirmation rouge.
 */
export function ConfirmDialog({ open, title, children, confirmLabel = "Confirmer", tone, reason, reasonHint, onConfirm, onClose }) {
  const [motif, setMotif] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setMotif("");
      setError(null);
      setPending(false);
    }
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    if (reason === "required" && !motif.trim()) {
      setError("Indiquez le motif : il est inscrit au journal.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm(motif.trim());
    } catch (cause) {
      setError(cause?.message ?? "Action refusée.");
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="m-confirm-t">
      <form onSubmit={submit} noValidate style={{ display: "grid", gap: "var(--space-4)" }}>
        <h2 id="m-confirm-t">{title}</h2>
        <div style={{ display: "grid", gap: "var(--space-3)" }}>{children}</div>
        {reason ? (
          <div className="field">
            <label className="label" htmlFor="m-confirm-motif">
              Motif {reason === "optional" ? <span className="muted">(facultatif)</span> : null}
            </label>
            <textarea
              className="textarea"
              id="m-confirm-motif"
              rows={2}
              maxLength={500}
              required={reason === "required"}
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              aria-describedby="m-confirm-motif-h"
            />
            <span className="hint" id="m-confirm-motif-h">
              {reasonHint ?? "Inscrit au journal d’audit avec l’action."}
            </span>
          </div>
        ) : null}
        <div aria-live="polite">
          {error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : null}
        </div>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant={tone === "danger" ? "danger" : "primary"} disabled={pending}>
            {pending ? "Patientez…" : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
