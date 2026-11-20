import { useEffect, useState } from "react";

import { SYSTEM_ROLE_ORDER, SystemRole } from "@/entities/session";
import { createUser, updateUser } from "@/entities/user";
import { ErrorCode, toAppError } from "@/shared/api";
import { Alert, Button, Modal } from "@/shared/ui";

/** Options du sélecteur de rôle : rôles système, puis rôles personnalisés. */
function RoleOptions({ roles }) {
  const system = roles.filter((r) => r.isSystem).sort((a, b) => SYSTEM_ROLE_ORDER.indexOf(a.name) - SYSTEM_ROLE_ORDER.indexOf(b.name));
  const custom = roles.filter((r) => !r.isSystem);
  return (
    <>
      {system.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
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

/** Prénom et nom. */
function NameFields({ prefix, form, onChange, hint }) {
  const describedBy = hint ? `${prefix}-name-h` : undefined;
  return (
    <>
      <div className="field">
        <label className="label" htmlFor={`${prefix}-prenom`}>
          Prénom
        </label>
        <input className="input" id={`${prefix}-prenom`} autoComplete="off" value={form.prenom} onChange={onChange("prenom")} aria-describedby={describedBy} />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${prefix}-nom`}>
          Nom
        </label>
        <input className="input" id={`${prefix}-nom`} autoComplete="off" value={form.nom} onChange={onChange("nom")} aria-describedby={describedBy} />
        {hint ? (
          <span className="hint" id={describedBy}>
            {hint}
          </span>
        ) : null}
      </div>
    </>
  );
}

/**
 * Création d'un compte (pas d'inscription publique) : adresse, rôle et modes de
 * connexion autorisés. La personne reçoit par e-mail son lien de première
 * connexion et choisit elle-même son mot de passe. Le prénom et le nom peuvent
 * rester vides : ils sont repris de Google au rattachement.
 * Les refus du serveur (adresse déjà prise, champ invalide) s'affichent tels quels.
 */
export function CreateUserModal({ open, roles, onClose, onCreated }) {
  const defaultRole = roles.find((r) => r.isSystem && r.name === SystemRole.PRACTITIONER) ?? roles[0];
  const [form, setForm] = useState({ prenom: "", nom: "", email: "", roleId: "", modes: ["mot_de_passe", "google"] });
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ prenom: "", nom: "", email: "", roleId: defaultRole?.id ?? "", modes: ["mot_de_passe", "google"] });
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleMode = (mode) => (e) =>
    setForm((f) => ({ ...f, modes: e.target.checked ? [...new Set([...f.modes, mode])] : f.modes.filter((m) => m !== mode) }));

  const submit = async (e) => {
    e.preventDefault();
    const email = form.email.trim();
    if (!email || email.indexOf("@") < 1) {
      setErrors({ email: "Saisissez l’adresse e-mail de la personne." });
      return;
    }
    if (!form.modes.length) {
      setErrors({ modes: "Autorisez au moins un mode de connexion." });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const user = await createUser({ email, prenom: form.prenom.trim(), nom: form.nom.trim(), roleId: form.roleId, loginModes: form.modes });
      onCreated(user);
    } catch (cause) {
      const error = toAppError(cause);
      // 409 `adresse_deja_prise` : le message du serveur s'affiche sous le champ concerné.
      setErrors(error.code === ErrorCode.CONFLICT ? { email: error.message } : { form: error.message });
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="m-create-t">
      <form onSubmit={submit} noValidate style={{ display: "grid", gap: "var(--space-4)" }}>
        <h2 id="m-create-t">Créer un compte</h2>
        <div className="modal-form">
          <Alert tone="info">
            La personne reçoit un e-mail : un lien (24 h) pour choisir elle-même son mot de passe, ou une invitation à « Continuer avec Google » si seul Google est
            autorisé. Vous ne choisissez jamais son mot de passe.
          </Alert>
          {errors.form ? (
            <Alert tone="danger" role="alert">
              {errors.form}
            </Alert>
          ) : null}
          <NameFields prefix="c" form={form} onChange={set} hint="Facultatifs : repris du compte Google à la première connexion s’ils restent vides." />
          <div className="field">
            <label className="label" htmlFor="c-mail">
              Adresse e-mail
            </label>
            <input
              className="input"
              id="c-mail"
              name="email"
              type="email"
              autoComplete="off"
              required
              value={form.email}
              onChange={set("email")}
              aria-invalid={errors.email ? "true" : undefined}
              aria-describedby="c-mail-h c-mail-err"
            />
            <span className="hint" id="c-mail-h">
              Identifiant de connexion. Pour la connexion Google, ce doit être l’adresse de son compte Google.
            </span>
            <p className="error-text" id="c-mail-err" role="alert" hidden={!errors.email}>
              {errors.email}
            </p>
          </div>
          <div className="field">
            <label className="label" htmlFor="c-role">
              Rôle
            </label>
            <select className="select" id="c-role" value={form.roleId ?? ""} onChange={set("roleId")}>
              <RoleOptions roles={roles} />
            </select>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }} aria-describedby="c-modes-err">
            <legend className="label" style={{ padding: 0, marginBottom: 6 }}>
              Modes de connexion autorisés
            </legend>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={form.modes.includes("mot_de_passe")} onChange={toggleMode("mot_de_passe")} />
              Adresse e-mail et mot de passe
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={form.modes.includes("google")} onChange={toggleMode("google")} />
              Compte Google
            </label>
            <span className="hint">Le mot de passe reste possible quand Internet est coupé au cabinet ; Google, non.</span>
            <p className="error-text" id="c-modes-err" role="alert" hidden={!errors.modes}>
              {errors.modes}
            </p>
          </fieldset>
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

/**
 * Modification du prénom, du nom et du rôle. L'adresse Google est
 * l'identifiant de connexion : non modifiable. Le refus « dernier
 * administrateur » vient du serveur et s'affiche tel quel.
 */
export function EditUserModal({ user, roles, lastAdmin, onClose, onSaved }) {
  const [form, setForm] = useState({ prenom: "", nom: "", roleId: "" });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (user) setForm({ prenom: user.prenom, nom: user.nom, roleId: user.roleId });
    setError(null);
  }, [user]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const patch = {};
    if (form.prenom.trim() !== user.prenom) patch.prenom = form.prenom.trim();
    if (form.nom.trim() !== user.nom) patch.nom = form.nom.trim();
    if (String(form.roleId) !== String(user.roleId)) patch.roleId = form.roleId;
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    setPending(true);
    try {
      onSaved(await updateUser(user.id, patch));
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setPending(false);
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
          <NameFields prefix="e" form={form} onChange={set} />
          <div className="field">
            <label className="label" htmlFor="e-mail">
              Adresse e-mail
            </label>
            <input className="input" id="e-mail" type="email" value={user?.email ?? ""} readOnly aria-describedby="e-mail-h" style={{ background: "var(--color-subtle)" }} />
            <p className="hint" id="e-mail-h">
              L’adresse Google est l’identifiant de connexion : elle ne se modifie pas.
            </p>
          </div>
          <div className="field">
            <label className="label" htmlFor="e-role">
              Rôle
            </label>
            <select className="select" id="e-role" aria-describedby="e-role-hint" value={form.roleId ?? ""} onChange={set("roleId")}>
              <RoleOptions roles={roles} />
            </select>
            <p className="hint" id="e-role-hint" hidden={!lastAdmin}>
              C’est le dernier administrateur actif : le serveur refusera de lui retirer ce rôle.
            </p>
          </div>
        </div>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
