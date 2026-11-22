import { useEffect, useState } from "react";

import { createRole, updateRole } from "@/entities/role";
import { toAppError } from "@/shared/api";
import { Alert, Button, Modal } from "@/shared/ui";

import { PERMISSION_GROUPS, SENSITIVE_PERMISSIONS, permissionLabel } from "../model/permission-groups";
import { summarizeRole } from "@/entities/role";

/**
 * Création ou modification d'un rôle personnalisé : nom, description et
 * permissions groupées par domaine, avec le résumé en clair de ce que le rôle
 * autorisera. `role` absent : création ; présent : modification.
 */
export function RoleFormModal({ open, role, catalog, onClose, onSaved }) {
  const editing = Boolean(role);
  const [form, setForm] = useState({ name: "", description: "", permissions: [] });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(role ? { name: role.name, description: role.description, permissions: [...role.permissions] } : { name: "", description: "", permissions: [] });
      setError(null);
    }
  }, [open, role]);

  const available = new Set(catalog.map((p) => p.code));
  const toggle = (code) =>
    setForm((f) => ({ ...f, permissions: f.permissions.includes(code) ? f.permissions.filter((c) => c !== code) : [...f.permissions, code] }));
  const summary = summarizeRole(form.permissions);

  const submit = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    if (name.length < 2) {
      setError("Saisissez un nom de rôle (2 caractères minimum).");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const payload = { name, description: form.description.trim(), permissions: form.permissions };
      onSaved(editing ? await updateRole(role.id, payload) : await createRole(payload));
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setPending(false);
    }
  };

  const titleId = editing ? "m-role-edit-t" : "m-role-t";
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} className="wide">
      <form onSubmit={submit} noValidate style={{ display: "grid", gap: "var(--space-4)" }}>
        <h2 id={titleId}>{editing ? `Modifier le rôle « ${role.name} »` : "Créer un rôle personnalisé"}</h2>
        <div aria-live="polite">
          {error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="r-name">
            Nom du rôle
          </label>
          <input className="input" id="r-name" autoComplete="off" required maxLength={80} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="field">
          <label className="label" htmlFor="r-desc">
            Description <span className="muted">(facultative)</span>
          </label>
          <input
            className="input"
            id="r-desc"
            autoComplete="off"
            maxLength={255}
            placeholder="À quoi sert ce rôle, pour qui"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>

        {PERMISSION_GROUPS.map((group) => (
          <fieldset key={group.legend}>
            <legend>{group.legend}</legend>
            {group.codes
              .filter((code) => available.has(code))
              .map((code) => (
                <label key={code} className="check-row">
                  <input type="checkbox" checked={form.permissions.includes(code)} onChange={() => toggle(code)} />
                  <span>{permissionLabel(code, catalog)}</span>
                </label>
              ))}
          </fieldset>
        ))}

        {form.permissions.some((c) => SENSITIVE_PERMISSIONS.has(c)) ? (
          <Alert tone="warning" icon="alert" title="Permission sensible">
            Ce rôle pourra modifier les comptes ou les droits de tous les comptes.
          </Alert>
        ) : null}

        <div className="summary" aria-live="polite" data-testid="role-summary">
          <strong>En clair :</strong>
          <div>
            <p style={{ margin: 0 }}>{summary.can}</p>
            {summary.cannot ? (
              <p className="muted" style={{ margin: 0 }}>
                {summary.cannot}
              </p>
            ) : null}
          </div>
        </div>

        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            {editing ? "Enregistrer le rôle" : "Créer le rôle"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Compatibilité : création seule. */
export function CreateRoleModal({ onCreated, ...props }) {
  return <RoleFormModal {...props} role={null} onSaved={onCreated} />;
}
