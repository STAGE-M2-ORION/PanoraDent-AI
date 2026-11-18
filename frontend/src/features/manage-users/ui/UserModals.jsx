import { useEffect, useState } from "react";

import { roleLabel } from "@/entities/session";
import { createUser, updateUser } from "@/entities/user";
import { ErrorCode, toAppError } from "@/shared/api";
import { Alert, Button, Modal } from "@/shared/ui";

const SYSTEM_ORDER = ["admin", "practitioner", "viewer"];

/** Options du sélecteur de rôle : rôles système, puis rôles personnalisés. */
function RoleOptions({ roles }) {
  const system = roles.filter((r) => r.isSystem).sort((a, b) => SYSTEM_ORDER.indexOf(a.name) - SYSTEM_ORDER.indexOf(b.name));
  const custom = roles.filter((r) => !r.isSystem);
  return (
    <>
      {system.map((r) => (
        <option key={r.id} value={r.id}>
          {roleLabel(r.name)}
        </option>
      ))}
      {custom.length ? (
        <optgroup label="Rôles personnalisés">
          {custom.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );
}

/**
 * Création d'un compte (pas d'inscription publique). Le backend exige un mot de
 * passe initial : l'administrateur en fixe un provisoire, que la personne
 * remplace depuis son profil.
 */
export function CreateUserModal({ open, roles, onClose, onCreated }) {
  const viewer = roles.find((r) => r.name === "viewer");
  const [form, setForm] = useState({ name: "", email: "", password: "", roleId: "" });
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ name: "", email: "", password: "", roleId: viewer?.id ?? roles[0]?.id ?? "" });
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = true;
    if (!form.email.trim() || form.email.indexOf("@") < 1) next.email = "Saisissez une adresse e-mail valide.";
    if (form.password.length < 8) next.password = "8 caractères minimum.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    try {
      const user = await createUser({ email: form.email.trim(), password: form.password, fullName: form.name.trim(), roleId: form.roleId });
      onCreated(user);
    } catch (cause) {
      const error = toAppError(cause);
      setErrors(error.code === ErrorCode.CONFLICT ? { email: "Cette adresse est déjà utilisée par un compte." } : { form: error.message });
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="m-create-t">
      <form onSubmit={submit} noValidate style={{ display: "grid", gap: "var(--space-4)" }}>
        <h2 id="m-create-t">Créer un compte</h2>
        <div className="modal-form">
          <Alert tone="info">Il n’existe pas d’inscription publique : seuls les administrateurs créent les comptes.</Alert>
          {errors.form ? (
            <Alert tone="danger" role="alert">
              {errors.form}
            </Alert>
          ) : null}
          <div className="field">
            <label className="label" htmlFor="c-name">
              Nom
            </label>
            <input className="input" id="c-name" autoComplete="off" required value={form.name} onChange={set("name")} aria-invalid={errors.name ? "true" : undefined} />
          </div>
          <div className="field">
            <label className="label" htmlFor="c-mail">
              E-mail professionnel
            </label>
            <input className="input" id="c-mail" type="email" autoComplete="off" required value={form.email} onChange={set("email")} aria-invalid={errors.email ? "true" : undefined} aria-describedby="c-mail-err" />
            <p className="error-text" id="c-mail-err" hidden={!errors.email}>
              {errors.email}
            </p>
          </div>
          <div className="field">
            <label className="label" htmlFor="c-role">
              Rôle
            </label>
            <select className="select" id="c-role" value={form.roleId} onChange={set("roleId")}>
              <RoleOptions roles={roles} />
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="c-pw">
              Mot de passe provisoire
            </label>
            <input className="input" id="c-pw" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} aria-invalid={errors.password ? "true" : undefined} aria-describedby="c-pw-h c-pw-err" />
            <span className="hint" id="c-pw-h">
              Transmettez-le de façon sûre : la personne le remplace depuis « Profil et mot de passe ».
            </span>
            <p className="error-text" id="c-pw-err" hidden={!errors.password}>
              {errors.password}
            </p>
          </div>
        </div>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            Créer le compte
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Modification du nom et du rôle. L'e-mail est l'identifiant : non modifiable par l'API. */
export function EditUserModal({ user, roles, lastAdmin, onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", roleId: "" });
  const [error, setError] = useState(null);
  useEffect(() => {
    if (user) setForm({ name: user.fullName, roleId: user.roleId });
    setError(null);
  }, [user]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const patch = { fullName: form.name.trim() || user.fullName };
      if (!lastAdmin && form.roleId !== user.roleId) patch.roleId = form.roleId;
      onSaved(await updateUser(user.id, patch));
    } catch (cause) {
      setError(toAppError(cause).message);
    }
  };

  return (
    <Modal open={Boolean(user)} onClose={onClose} labelledBy="m-edit-t">
      <form onSubmit={submit} noValidate style={{ display: "grid", gap: "var(--space-4)" }}>
        <h2 id="m-edit-t">Modifier le compte</h2>
        <div className="modal-form">
          {error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : null}
          <div className="field">
            <label className="label" htmlFor="e-name">
              Nom
            </label>
            <input className="input" id="e-name" autoComplete="off" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="field">
            <label className="label" htmlFor="e-mail">
              E-mail professionnel
            </label>
            <input className="input" id="e-mail" type="email" value={user?.email ?? ""} readOnly aria-describedby="e-mail-h" style={{ background: "var(--color-subtle)" }} />
            <p className="hint" id="e-mail-h">
              L’e-mail est l’identifiant de connexion : il ne se modifie pas.
            </p>
          </div>
          <div className="field">
            <label className="label" htmlFor="e-role">
              Rôle
            </label>
            <select className="select" id="e-role" aria-describedby="e-role-hint" disabled={lastAdmin} value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
              <RoleOptions roles={roles} />
            </select>
            <p className="hint" id="e-role-hint" hidden={!lastAdmin}>
              Le rôle du dernier administrateur ne peut pas être changé.
            </p>
          </div>
        </div>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit">Enregistrer</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Suppression définitive, avec case de confirmation. */
export function DeleteUserModal({ user, onClose, onConfirm }) {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(false), [user]);
  return (
    <Modal open={Boolean(user)} onClose={onClose} labelledBy="m-delete-t">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onConfirm(user);
        }}
        style={{ display: "grid", gap: "var(--space-4)" }}
      >
        <h2 id="m-delete-t">Supprimer le compte ?</h2>
        <p id="m-delete-d">
          Vous allez supprimer le compte <strong>{user?.fullName || user?.email}</strong>. Cette action est définitive et sera inscrite au journal d’audit.
        </p>
        <label className="check-row" htmlFor="d-ok">
          <input type="checkbox" id="d-ok" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span>Je confirme la suppression de ce compte.</span>
        </label>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="danger" type="submit" disabled={!ok}>
            Supprimer définitivement
          </Button>
        </div>
      </form>
    </Modal>
  );
}
