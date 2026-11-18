import { useEffect, useState } from "react";

import { createRole } from "@/entities/role";
import { ErrorCode, toAppError } from "@/shared/api";
import { Alert, Button, Modal } from "@/shared/ui";

import { PERMISSION_GROUPS, SENSITIVE_PERMISSIONS, permissionLabel } from "../model/permission-groups";

/** Création d'un rôle personnalisé : nom, description, permissions groupées. */
export function CreateRoleModal({ open, catalog, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [checked, setChecked] = useState([]);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setChecked([]);
      setError(null);
    }
  }, [open]);

  const available = new Set(catalog.map((p) => p.code));
  const toggle = (code) => setChecked((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));

  const submit = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("Saisissez un nom de rôle (2 caractères minimum).");
      return;
    }
    setPending(true);
    try {
      onCreated(await createRole({ name: name.trim(), description: description.trim(), permissions: checked }));
    } catch (cause) {
      const appError = toAppError(cause);
      setError(appError.code === ErrorCode.CONFLICT ? "Ce nom est déjà utilisé par un rôle." : appError.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="m-role-t" className="wide">
      <form onSubmit={submit} noValidate style={{ display: "grid", gap: "var(--space-4)" }}>
        <h2 id="m-role-t">Créer un rôle personnalisé</h2>
        <div className="field">
          <label className="label" htmlFor="r-name">
            Nom du rôle
          </label>
          <input className="input" id="r-name" autoComplete="off" required value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error ? "true" : undefined} aria-describedby="r-name-err" />
          <p className="error-text" id="r-name-err" hidden={!error}>
            {error}
          </p>
        </div>
        <div className="field">
          <label className="label" htmlFor="r-desc">
            Description
          </label>
          <textarea className="textarea" id="r-desc" style={{ minHeight: 64 }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {PERMISSION_GROUPS.map((group) => (
          <fieldset key={group.legend}>
            <legend>{group.legend}</legend>
            {group.codes
              .filter((code) => available.has(code))
              .map((code) => (
                <label key={code} className="check-row">
                  <input type="checkbox" checked={checked.includes(code)} onChange={() => toggle(code)} />
                  <span>{permissionLabel(code, catalog)}</span>
                </label>
              ))}
          </fieldset>
        ))}

        {checked.some((c) => SENSITIVE_PERMISSIONS.has(c)) ? (
          <Alert tone="warning" icon="alert" role="alert" title="Permission sensible">
            Permission sensible : ce rôle pourra modifier les comptes ou les droits de tous les comptes.
          </Alert>
        ) : null}

        <div className="summary" aria-live="polite">
          <strong>Ce rôle pourra :</strong>
          <div>
            {checked.length ? (
              <ul>
                {checked.map((c) => (
                  <li key={c}>{permissionLabel(c, catalog)}</li>
                ))}
              </ul>
            ) : (
              <span className="muted">Aucune permission sélectionnée pour l’instant.</span>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            Créer le rôle
          </Button>
        </div>
      </form>
    </Modal>
  );
}
