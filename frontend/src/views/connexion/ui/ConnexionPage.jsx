import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";

import { DetSwatch } from "@/entities/detection";
import { GOOGLE_SIGN_IN_URL, SessionEndReason, SessionStatus, homePathFor, useCurrentUser } from "@/entities/session";
import { ErrorCode, toAppError } from "@/shared/api";
import { Alert, Button, Field, GoogleMark, Icon, Input, PasswordInput } from "@/shared/ui";
import { AuthCard } from "@/widgets/auth-card";

/**
 * Codes d'échec renvoyés par le backend dans `?erreur=` au retour de Google.
 * `retry` : erreur passagère, on propose de recommencer (encart neutre) ;
 * sinon, le blocage relève de l'administrateur ou de Google (encart rouge).
 */
export const GOOGLE_ERRORS = {
  compte_inconnu: {
    title: "Aucun compte pour cette adresse Google",
    text: "Cette adresse n’est associée à aucun compte PanoraDent AI. Demandez à l’administrateur de votre cabinet de vous créer un compte avec cette adresse, puis reconnectez-vous.",
  },
  compte_desactive: {
    title: "Compte désactivé",
    text: "Votre compte a été désactivé. Contactez l’administrateur de votre cabinet pour qu’il le réactive.",
  },
  google_non_autorise: {
    title: "Connexion Google non autorisée pour ce compte",
    text: "Ce compte se connecte avec son adresse e-mail et son mot de passe. Utilisez le formulaire ci-dessus, ou demandez à l’administrateur d’autoriser la connexion Google.",
  },
  google_non_rattache: {
    title: "Ce compte Google n’est pas celui du compte",
    text: "Un autre compte Google est déjà rattaché à cette adresse. Connectez-vous avec le compte Google habituel, ou avec votre mot de passe.",
  },
  adresse_non_verifiee: {
    title: "Adresse Google non vérifiée",
    text: "Google n’a pas confirmé que cette adresse e-mail vous appartient. Vérifiez-la depuis les paramètres de votre compte Google, puis reconnectez-vous.",
  },
  etat_invalide: {
    retry: true,
    title: "La connexion n’a pas abouti",
    text: "La demande de connexion a expiré ou a été interrompue. Cela arrive si la page est restée ouverte longtemps ou si plusieurs onglets se connectent en même temps.",
  },
  echec_google: {
    retry: true,
    title: "La connexion n’a pas abouti",
    text: "Google n’a pas pu confirmer votre identité, par exemple si vous avez annulé ou si la connexion a été coupée.",
  },
  session_expiree: {
    retry: true,
    title: "Votre session a expiré",
    text: "Reconnectez-vous, puis recommencez depuis votre profil.",
  },
};

/** Messages d'arrivée (`?etat=`), posés par la garde de route et la déconnexion. */
const ARRIVALS = {
  [SessionEndReason.EXPIRED]: { tone: "info", icon: "clock", text: "Votre session a expiré. Reconnectez-vous pour reprendre." },
  [SessionEndReason.SIGNED_OUT]: { tone: "success", icon: "check", text: "Vous êtes déconnecté." },
};

/**
 * Refus du formulaire mot de passe → encart affiché. Le message neutre du
 * serveur s'affiche tel quel : il ne dit pas si l'adresse existe.
 */
export function passwordLoginNotice(error) {
  const e = toAppError(error);
  switch (e.serverCode) {
    case "identifiants_invalides":
      return { tone: "danger", code: e.serverCode, text: e.message };
    case "compte_verrouille":
      return { tone: "danger", code: e.serverCode, title: "Compte verrouillé temporairement", text: e.message };
    case "compte_desactive":
      return { tone: "danger", code: e.serverCode, title: "Compte désactivé", text: e.message };
    default:
      return {
        retry: true,
        code: e.serverCode ?? e.code,
        title: "La connexion n’a pas abouti",
        text: e.code === ErrorCode.NETWORK || e.code === ErrorCode.TIMEOUT ? e.message : "Une erreur inattendue est survenue. Réessayez.",
      };
  }
}

const queryValue = (value) => (typeof value === "string" ? value : "");

/**
 * « Continuer avec Google », conforme aux consignes de marque Google (fond
 * blanc, bordure #747775, texte #1F1F1F, logo « G » officiel). C'est un VRAI
 * lien : une redirection OAuth ne se suit pas en arrière-plan.
 */
function GoogleButton({ pending, onNavigate }) {
  return (
    <a className="gsi-btn" href={GOOGLE_SIGN_IN_URL} onClick={onNavigate} aria-disabled={pending || undefined} aria-describedby="hint-g">
      {pending ? <span className="gsi-spinner" aria-hidden="true" /> : <GoogleMark />}
      <span>{pending ? "Redirection vers Google…" : "Continuer avec Google"}</span>
    </a>
  );
}

/**
 * Écran de connexion : adresse e-mail et mot de passe, ou compte Google.
 *
 * - `?erreur=<code>` : échec renvoyé par le backend au retour de Google ;
 * - `?etat=expiree` | `deconnecte` : bandeau d'arrivée.
 *
 * Déjà connecté : redirection vers la page d'arrivée du rôle.
 */
export function ConnexionPage() {
  const router = useRouter();
  const { status, user, login } = useCurrentUser();
  const [form, setForm] = useState({ email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [notice, setNotice] = useState({ error: null, arrival: null });
  const passwordRef = useRef(null);

  // Lu après hydratation : les messages entrent dans la région `aria-live`
  // déjà présente, ils sont donc annoncés par les lecteurs d'écran.
  useEffect(() => {
    if (!router.isReady) return;
    const code = queryValue(router.query.erreur);
    setNotice({
      error: code ? { code, tone: "danger", fromGoogle: true, ...(GOOGLE_ERRORS[code] ?? GOOGLE_ERRORS.echec_google) } : null,
      arrival: ARRIVALS[queryValue(router.query.etat)] ?? null,
    });
  }, [router.isReady, router.query.erreur, router.query.etat]);

  // Retour arrière depuis Google : la page peut sortir du cache du navigateur
  // avec le bouton encore « en cours ».
  useEffect(() => {
    const onPageShow = (event) => {
      if (event.persisted) setGooglePending(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    if (status === SessionStatus.AUTHENTICATED) router.replace(homePathFor(user));
  }, [status, user, router]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setNotice({ error: null, arrival: null });
    try {
      await login(form.email.trim(), form.password);
      // La redirection suit le passage à « authenticated » (effet ci-dessus).
    } catch (cause) {
      setNotice({ error: passwordLoginNotice(cause), arrival: null });
      setForm((f) => ({ ...f, password: "" }));
      passwordRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const goGoogle = (event) => {
    if (googlePending) {
      event.preventDefault();
      return;
    }
    setGooglePending(true);
  };

  const { error, arrival } = notice;

  return (
    <AuthCard
      docTitle="Connexion"
      aside={
        <>
          <div className="float float-import" aria-hidden="true">
            <Icon name="upload" />
          </div>
          <div className="float float-result" aria-hidden="true">
            <p className="t">Analyse terminée</p>
            <ul>
              <li>
                <DetSwatch label="caries" />
                36 · carie · 94&nbsp;%
              </li>
              <li>
                <DetSwatch label="periapical_lesion" />
                46 · lésion apicale · 88&nbsp;%
              </li>
              <li>
                <DetSwatch label="impacted_tooth" />
                38 · dent incluse · 91&nbsp;%
              </li>
            </ul>
          </div>
        </>
      }
    >
      <div className="panel-v">
        <h1>Connexion</h1>
        <p className="sous">Accès réservé aux praticiens et au personnel autorisé.</p>

        <div className="auth-notices" aria-live="polite" aria-atomic="true">
          {arrival && !error ? (
            <Alert tone={arrival.tone} icon={arrival.icon}>
              {arrival.text}
            </Alert>
          ) : null}
          {error && !error.retry ? (
            <Alert tone="danger" icon="alert" title={error.title} data-erreur={error.code}>
              {error.text}
            </Alert>
          ) : null}
          {error?.retry ? (
            <div className="auth-neutral" data-erreur={error.code}>
              <Icon name="info" />
              <div>
                <strong>{error.title}</strong>
                <p>{error.text}</p>
                {error.fromGoogle ? (
                  <a className="btn btn-secondary btn-sm" href={GOOGLE_SIGN_IN_URL} onClick={goGoogle}>
                    Réessayer
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <form onSubmit={submit} noValidate={false} aria-label="Connexion par adresse e-mail">
          <fieldset disabled={submitting}>
            <Field label="Adresse e-mail" htmlFor="c-email">
              <Input id="c-email" type="email" autoComplete="username" inputMode="email" value={form.email} onChange={set("email")} required />
            </Field>
            <Field label="Mot de passe" htmlFor="c-mdp">
              <PasswordInput ref={passwordRef} id="c-mdp" autoComplete="current-password" value={form.password} onChange={set("password")} required />
            </Field>
            <div className="auth-row">
              <Link className="auth-link" href="/mot-de-passe-oublie">
                Mot de passe oublié ?
              </Link>
            </div>
            <Button type="submit" className="btn-block" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Connexion…
                </>
              ) : (
                "Se connecter"
              )}
            </Button>
          </fieldset>
        </form>

        <p className="auth-sep">ou</p>

        <GoogleButton pending={googlePending} onNavigate={goGoogle} />
        <p className="hint-g" id="hint-g">
          L’accès est réservé aux comptes créés par l’administrateur de votre cabinet. Avec Google, utilisez l’adresse enregistrée sur votre compte.
        </p>
      </div>
    </AuthCard>
  );
}
