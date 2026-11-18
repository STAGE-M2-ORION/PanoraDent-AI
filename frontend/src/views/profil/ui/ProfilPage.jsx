import { useRouter } from "next/router";
import { useState } from "react";

import { Permission, PasswordInput, PasswordStrength, changeMyPassword, displayName, evaluatePassword, roleLabel, useCurrentUser } from "@/entities/session";
import { updateUser } from "@/entities/user";
import { ErrorCode, toAppError } from "@/shared/api";
import { formatDateTime } from "@/shared/lib";
import { Alert, Badge, Button, GoogleMark, Icon } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

function InfoCard() {
  const { user, can } = useCurrentUser();
  const [name, setName] = useState(user?.fullName ?? "");
  const [msg, setMsg] = useState(null);
  const canSave = can(Permission.USER_MANAGE);

  const save = async () => {
    if (!canSave) {
      setMsg({ tone: "info", text: "Votre nom est modifiable par l’administrateur de votre cabinet." });
      return;
    }
    try {
      await updateUser(user.id, { fullName: name.trim() });
      setMsg({ tone: "success", text: "Informations enregistrées. Elles s’afficheront à votre prochaine connexion." });
    } catch (cause) {
      setMsg({ tone: "danger", text: toAppError(cause).message });
    }
  };

  return (
    <section className="card card-pad" aria-labelledby="h-info">
      <div className="card-head">
        <h3 id="h-info">Mes informations</h3>
      </div>
      <div className="form">
        <div className="field">
          <label className="label" htmlFor="i-nom">
            Nom
          </label>
          <input className="input" id="i-nom" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="i-mail">
            Adresse e-mail
          </label>
          <input className="input ro" id="i-mail" type="email" autoComplete="email" value={user?.email ?? ""} readOnly aria-describedby="i-mail-h" />
          <span className="hint" id="i-mail-h">
            Identifiant de connexion : modifiable uniquement par l’administrateur.
          </span>
        </div>
        <div className="field">
          <label className="label" htmlFor="i-role">
            Rôle
          </label>
          <input className="input ro" id="i-role" value={roleLabel(user?.role)} readOnly aria-describedby="i-role-h" />
          <span className="hint" id="i-role-h">
            Modifiable uniquement par l’administrateur.
          </span>
        </div>
        {msg ? (
          <Alert tone={msg.tone} role="status">
            {msg.text}
          </Alert>
        ) : null}
        <div>
          <Button variant="secondary" onClick={save}>
            Enregistrer mes informations
          </Button>
        </div>
      </div>
    </section>
  );
}

function PasswordCard() {
  const router = useRouter();
  const { logout } = useCurrentUser();
  const [form, setForm] = useState({ old: "", pw: "", pw2: "" });
  const [show, setShow] = useState({ old: false, pw: false, pw2: false });
  const [state, setState] = useState({ pending: false, error: null, oldWrong: false });
  const { valid } = evaluatePassword(form.pw);
  const mismatch = Boolean(form.pw2) && form.pw2 !== form.pw;
  const ready = valid && !mismatch && form.pw2 && form.old;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (k) => () => setShow((s) => ({ ...s, [k]: !s[k] }));

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setState({ pending: true, error: null, oldWrong: false });
    try {
      await changeMyPassword(form.old, form.pw);
      // Le serveur ferme toutes les sessions : on repart d'une connexion propre.
      await logout();
      router.replace({ pathname: "/connexion", query: { etat: "mot-de-passe-modifie" } });
    } catch (cause) {
      const error = toAppError(cause);
      const oldWrong = error.code === ErrorCode.VALIDATION && /actuel/i.test(error.message);
      setState({ pending: false, error: oldWrong ? "Le mot de passe actuel est incorrect." : error.message, oldWrong });
    }
  };

  return (
    <section className="card card-pad" aria-labelledby="h-pw">
      <div className="card-head">
        <h3 id="h-pw">Changer mon mot de passe</h3>
      </div>
      <div aria-live="polite" style={{ marginBottom: state.error ? "var(--space-4)" : 0 }}>
        {state.error ? (
          <Alert tone="danger" icon="alert" role="alert">
            {state.error}
          </Alert>
        ) : null}
      </div>
      <form className="form" noValidate onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="p-old">
            Mot de passe actuel
          </label>
          <PasswordInput
            id="p-old"
            autoComplete="current-password"
            aria-describedby="p-old-err"
            aria-invalid={state.oldWrong ? "true" : undefined}
            value={form.old}
            onChange={set("old")}
            visible={show.old}
            onToggle={toggle("old")}
            label="le mot de passe actuel"
          />
          <span className="error-text" id="p-old-err" hidden={!state.oldWrong}>
            Le mot de passe actuel est incorrect.
          </span>
        </div>
        <div className="field">
          <label className="label" htmlFor="p-new">
            Nouveau mot de passe
          </label>
          <PasswordInput id="p-new" autoComplete="new-password" aria-describedby="rules meter-txt" value={form.pw} onChange={set("pw")} visible={show.pw} onToggle={toggle("pw")} label="le nouveau mot de passe" />
        </div>
        <PasswordStrength value={form.pw} />
        <div className="field">
          <label className="label" htmlFor="p-new2">
            Confirmer le nouveau mot de passe
          </label>
          <PasswordInput
            id="p-new2"
            autoComplete="new-password"
            aria-describedby="p-err"
            aria-invalid={mismatch ? "true" : "false"}
            value={form.pw2}
            onChange={set("pw2")}
            visible={show.pw2}
            onToggle={toggle("pw2")}
            label="la confirmation"
          />
          <span className="error-text" id="p-err" hidden={!mismatch}>
            Les deux mots de passe ne correspondent pas.
          </span>
        </div>
        <div>
          <Button type="submit" disabled={!ready || state.pending}>
            Enregistrer le nouveau mot de passe
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Profil, mot de passe, connexion Google, sessions et rappel de sécurité. */
export function ProfilPage() {
  const router = useRouter();
  const { user, logout } = useCurrentUser();
  const [googleMsg, setGoogleMsg] = useState(false);
  const [othersMsg, setOthersMsg] = useState(false);

  return (
    <AppShell page="profil" title="Profil et mot de passe" crumbs="Compte" className="v-profil">
      <div className="stack">
        <InfoCard />
        <PasswordCard />

        <section className="card card-pad" aria-labelledby="h-google">
          <div className="card-head">
            <h3 id="h-google">Connexion avec Google</h3>
            <span>
              <Badge>Non associé</Badge>
            </span>
          </div>
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            <p className="hint">
              Aucun compte Google associé. L’adresse Google doit être celle de votre compte PanoraDent ; sinon, demandez à l’administrateur de la modifier.
            </p>
            <div className="btn-row">
              <button className="btn btn-google" type="button" style={{ width: "auto" }} onClick={() => setGoogleMsg(true)}>
                <GoogleMark />
                Associer un compte Google
              </button>
            </div>
          </div>
          {googleMsg ? (
            <div style={{ marginTop: "var(--space-4)" }}>
              <Alert tone="info" role="status">
                La connexion avec Google n’est pas encore activée sur ce serveur.
              </Alert>
            </div>
          ) : null}
        </section>

        <section className="card card-pad" aria-labelledby="h-sess">
          <div className="card-head">
            <h3 id="h-sess">Sessions</h3>
          </div>
          <ul className="sess">
            <li>
              <span>
                <strong>Session actuelle</strong>
                <br />
                <span className="muted">{displayName(user)} · ce navigateur</span>
              </span>
              <Badge tone="success" dot>
                Active
              </Badge>
            </li>
            <li>
              <span>
                <strong>Dernière connexion</strong>
                <br />
                <span className="muted">{user?.lastLoginAt ? formatDateTime(user.lastLoginAt) : "—"}</span>
              </span>
            </li>
          </ul>
          <div className="btn-row">
            <Button
              variant="secondary"
              onClick={async () => {
                await logout();
                router.replace({ pathname: "/connexion", query: { etat: "deconnecte" } });
              }}
            >
              <Icon name="logout" />
              Se déconnecter
            </Button>
            <Button variant="secondary" onClick={() => setOthersMsg(true)}>
              Fermer les autres sessions
            </Button>
          </div>
          {othersMsg ? (
            <div style={{ marginTop: "var(--space-4)" }}>
              <Alert tone="info" role="status">
                Pour fermer toutes vos sessions, changez votre mot de passe : le serveur déconnecte alors tous vos appareils. La fermeture sélective n’est pas encore disponible.
              </Alert>
            </div>
          ) : null}
        </section>

        <section className="card card-pad" aria-labelledby="h-sec">
          <div className="card-head">
            <h3 id="h-sec">Rappel de sécurité</h3>
          </div>
          <ul className="sec-list">
            <li>Le compte est verrouillé 15 minutes après 5 échecs de connexion.</li>
            <li>La session expire après 15 minutes sans activité si elle n’est pas rafraîchie, et au bout de 7 jours au plus.</li>
            <li>Changer de mot de passe ferme toutes les sessions ouvertes.</li>
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
