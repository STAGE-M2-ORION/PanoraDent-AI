import Head from "next/head";
import { useRouter } from "next/router";
import { useState } from "react";

import {
  GOOGLE_LINK_URL,
  SessionStatus,
  changeMyPassword,
  completeFirstLogin,
  homePathFor,
  useCurrentUser,
} from "@/entities/session";
import { LinkPasswordForm, NewPasswordFields, checkNewPassword } from "@/features/set-password";
import { toAppError } from "@/shared/api";
import { Alert, Button, Field, GoogleMark, PasswordInput } from "@/shared/ui";
import { AuthCard } from "@/widgets/auth-card";

/**
 * Le compte doit choisir un nouveau mot de passe (`doit_changer_mdp`, posé par
 * l'administrateur) : la garde de route renvoie ici tant que c'est le cas.
 */
function ForcedChange({ user, onDone }) {
  const [current, setCurrent] = useState("");
  const [value, setValue] = useState({ password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    const problem = checkNewPassword(value, user.email);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changeMyPassword(user.hasPassword ? current : null, value.password);
      await onDone();
    } catch (cause) {
      setError(toAppError(cause).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label="Choix d’un nouveau mot de passe">
      <fieldset disabled={busy}>
        <div aria-live="polite">{error ? <Alert tone="danger" icon="alert">{error}</Alert> : null}</div>
        {user.hasPassword ? (
          <Field label="Mot de passe actuel" htmlFor="pc-actuel">
            <PasswordInput id="pc-actuel" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
        ) : null}
        <NewPasswordFields value={value} onChange={setValue} email={user.email} idPrefix="pc" disabled={busy} error={error} />
        <Button type="submit" className="btn-block" disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer et continuer"}
        </Button>
      </fieldset>
    </form>
  );
}

/** Après le choix du mot de passe : proposer de rattacher Google, si l'administrateur l'autorise. */
function LinkGoogleOffer({ user, onContinue }) {
  return (
    <div className="auth-done" aria-live="polite">
      <Alert tone="success" icon="check" title="Mot de passe enregistré" data-etat="premiere-connexion-ok">
        Votre compte est activé et votre session est ouverte.
      </Alert>
      <p style={{ margin: 0 }}>
        Vous pouvez aussi vous connecter avec Google, depuis l’adresse <strong>{user.email}</strong>. Rattachez votre compte Google maintenant, ou plus tard
        depuis votre profil.
      </p>
      <a className="gsi-btn" href={GOOGLE_LINK_URL}>
        <GoogleMark />
        <span>Rattacher mon compte Google</span>
      </a>
      <Button variant="ghost" className="btn-block" onClick={onContinue}>
        Plus tard, continuer vers l’application
      </Button>
    </div>
  );
}

/**
 * Première connexion, depuis le lien reçu à la création du compte
 * (`?jeton=`) : le nouveau compte choisit lui-même son mot de passe, sa
 * session s'ouvre, puis on lui propose de rattacher son compte Google.
 *
 * Sans jeton, pour un compte connecté qui doit changer de mot de passe : même
 * page, formulaire de changement.
 */
export function PremiereConnexionPage() {
  const router = useRouter();
  const { status, user, reload } = useCurrentUser();
  const [linked, setLinked] = useState(null);
  const token = typeof router.query.jeton === "string" ? router.query.jeton : "";
  const goHome = (u) => router.replace(homePathFor(u ?? user));

  let content = null;
  if (!router.isReady || (!token && status === SessionStatus.LOADING)) {
    content = null;
  } else if (linked) {
    content = <LinkGoogleOffer user={linked} onContinue={() => goHome(linked)} />;
  } else if (token) {
    content = (
      <LinkPasswordForm
        key={token}
        token={token}
        submitLabel="Activer mon compte"
        renewHint="Demandez à l’administrateur de votre cabinet de vous renvoyer un lien, ou utilisez « Mot de passe oublié »."
        submit={(password) => completeFirstLogin(token, password)}
        onDone={async () => {
          const u = await reload();
          const canLinkGoogle = u.loginModes.includes("google") && !u.googleLinked;
          if (canLinkGoogle) setLinked(u);
          else goHome(u);
        }}
      />
    );
  } else if (status === SessionStatus.AUTHENTICATED && user?.mustChangePassword) {
    content = <ForcedChange user={user} onDone={async () => goHome(await reload())} />;
  } else {
    content = <LinkPasswordForm token="" renewHint="Utilisez le lien reçu par e-mail, ou demandez-en un nouveau." submit={() => null} onDone={() => null} />;
  }

  const forced = !token && user?.mustChangePassword;
  return (
    <AuthCard docTitle="Première connexion">
      <Head>
        <meta name="referrer" content="no-referrer" />
      </Head>
      <div className="panel-v">
        <h1>{forced ? "Choisissez un nouveau mot de passe" : "Première connexion"}</h1>
        <p className="sous">
          {forced
            ? "L’administrateur a réinitialisé votre accès : choisissez un nouveau mot de passe pour continuer."
            : "Bienvenue sur PanoraDent AI. Choisissez le mot de passe de votre compte."}
        </p>
        {content}
      </div>
    </AuthCard>
  );
}
