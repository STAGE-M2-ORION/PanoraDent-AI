import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";

import { DetSwatch } from "@/entities/detection";
import { PasswordInput, PasswordStrength, SessionStatus, evaluatePassword, requestPasswordReset, useCurrentUser } from "@/entities/session";
import { SignInForm } from "@/features/sign-in";
import { ErrorCode, toAppError } from "@/shared/api";
import { Alert, Button, Icon } from "@/shared/ui";

/** Panneaux de la colonne de gauche : la photo, elle, ne bouge pas. */
const PANELS = ["login", "reset", "sent", "nouveau", "expire", "succes"];

/** Destination après connexion : `?next=` s'il pointe dans l'application. */
function safeNext(next) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/connexion") ? next : "/tableau-de-bord";
}

function PanelTitle({ id, children, focus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <h1 id={id} tabIndex={-1} ref={ref}>
      {children}
    </h1>
  );
}

function ResetPanel({ initialEmail, onSent, onBack, focus }) {
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      onSent();
    } catch (cause) {
      const appError = toAppError(cause);
      setError(
        appError.code === ErrorCode.NOT_FOUND
          ? "La réinitialisation par e-mail n’est pas encore disponible sur ce serveur. Contactez l’administrateur de votre cabinet : il peut définir un nouveau mot de passe depuis la gestion des comptes."
          : appError.message,
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="panel-v">
      <PanelTitle id="t-reset" focus={focus}>
        Mot de passe oublié
      </PanelTitle>
      <p className="sous">Saisissez l’adresse e-mail de votre compte. Nous vous enverrons un lien de réinitialisation.</p>
      {error ? (
        <Alert tone="warning" icon="info" role="alert">
          {error}
        </Alert>
      ) : null}
      <form onSubmit={submit} noValidate style={{ display: "grid", gap: "var(--space-4)" }}>
        <div className="field">
          <label className="label" htmlFor="r-mail">
            Adresse e-mail
          </label>
          <input className="input" id="r-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button className="btn-connexion" type="submit" disabled={pending || !email.trim()}>
          Envoyer le lien
        </Button>
      </form>
      <p className="retour">
        <a href="#connexion" onClick={(e) => (e.preventDefault(), onBack())}>
          Retour à la connexion
        </a>
      </p>
    </div>
  );
}

function NewPasswordPanel({ onDone, focus }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState({ a: false, b: false });
  const { valid } = evaluatePassword(pw);
  const mismatch = Boolean(pw2) && pw2 !== pw;
  return (
    <div className="panel-v">
      <PanelTitle id="t-nouveau" focus={focus}>
        Choisir un nouveau mot de passe
      </PanelTitle>
      <p className="sous">Ce lien est à usage unique.</p>
      <form
        noValidate
        style={{ display: "grid", gap: "var(--space-3)" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !mismatch && pw2) onDone();
        }}
      >
        <div className="field">
          <label className="label" htmlFor="n-pw">
            Nouveau mot de passe
          </label>
          <PasswordInput
            id="n-pw"
            autoComplete="new-password"
            aria-describedby="rules meter-txt"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            visible={show.a}
            onToggle={() => setShow((s) => ({ ...s, a: !s.a }))}
          />
        </div>
        <PasswordStrength value={pw} />
        <div className="field">
          <label className="label" htmlFor="n-pw2">
            Confirmer le mot de passe
          </label>
          <PasswordInput
            id="n-pw2"
            autoComplete="new-password"
            aria-describedby="n-err"
            aria-invalid={mismatch ? "true" : "false"}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            visible={show.b}
            onToggle={() => setShow((s) => ({ ...s, b: !s.b }))}
            label="la confirmation"
          />
          <span className="error-text" id="n-err" role="alert" hidden={!mismatch}>
            Les deux mots de passe ne correspondent pas.
          </span>
        </div>
        <Button className="btn-connexion" type="submit" disabled={!(valid && !mismatch && pw2)}>
          Enregistrer le nouveau mot de passe
        </Button>
      </form>
    </div>
  );
}

/**
 * Écran de connexion : carte en deux colonnes (formulaire 36 %, photo 64 %).
 * `?etat=` : `deconnecte`, `expiree`, `oubli`, `nouveau`, `expire`, `succes`.
 */
export function ConnexionPage() {
  const router = useRouter();
  const { status } = useCurrentUser();
  const etat = typeof router.query.etat === "string" ? router.query.etat : "";
  const [panel, setPanel] = useState("login");
  const [focusPanel, setFocusPanel] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [arrival, setArrival] = useState("");

  useEffect(() => {
    if (!router.isReady) return;
    if (etat === "oubli") setPanel("reset");
    else if (PANELS.includes(etat)) setPanel(etat);
    setArrival(etat);
  }, [router.isReady, etat]);

  // Déjà connecté (onglet rouvert) : direction l'application.
  useEffect(() => {
    if (status === SessionStatus.AUTHENTICATED && router.isReady) router.replace(safeNext(router.query.next));
  }, [status, router]);

  const show = (name) => {
    setPanel(name);
    setFocusPanel(true);
  };

  return (
    <div className="v-connexion">
      <Head>
        <title>Connexion · PanoraDent AI</title>
      </Head>
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-form">
            <Link className="auth-logo" href="/" aria-label="PanoraDent AI, accueil">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/Logo_clair_transparent.svg" alt="PanoraDent AI" />
            </Link>

            {panel === "login" ? (
              <div className="panel-v">
                <PanelTitle id="t-login" focus={focusPanel}>
                  Connexion
                </PanelTitle>
                <p className="sous">Accès réservé aux praticiens et au personnel autorisé.</p>
                <SignInForm
                  arrival={arrival}
                  onSignedIn={() => router.replace(safeNext(router.query.next))}
                  onForgot={(email) => {
                    setResetEmail(email);
                    show("reset");
                  }}
                />
              </div>
            ) : null}

            {panel === "reset" ? <ResetPanel initialEmail={resetEmail} focus={focusPanel} onSent={() => show("sent")} onBack={() => show("login")} /> : null}

            {panel === "sent" ? (
              <div className="panel-v">
                <PanelTitle id="t-sent" focus={focusPanel}>
                  Vérifiez votre messagerie
                </PanelTitle>
                <Alert tone="success" icon="mail" role="status">
                  Si un compte correspond à cette adresse, un lien de réinitialisation valable 30 minutes vient d’être envoyé.
                </Alert>
                <p className="sous">Rien reçu ? Vérifiez vos courriers indésirables, ou contactez l’administrateur de votre cabinet.</p>
                <Button variant="secondary" className="btn-connexion" onClick={() => show("login")}>
                  Retour à la connexion
                </Button>
              </div>
            ) : null}

            {panel === "nouveau" ? <NewPasswordPanel focus={focusPanel} onDone={() => show("succes")} /> : null}

            {panel === "expire" ? (
              <div className="panel-v">
                <PanelTitle id="t-expire" focus={focusPanel}>
                  Lien expiré
                </PanelTitle>
                <Alert tone="danger" icon="alert" title="Ce lien n’est plus valable." role="alert">
                  Il a expiré (validité de 30 minutes) ou a déjà été utilisé.
                </Alert>
                <Button className="btn-connexion" onClick={() => show("reset")}>
                  Demander un nouveau lien
                </Button>
                <p className="retour">
                  <a href="#connexion" onClick={(e) => (e.preventDefault(), show("login"))}>
                    Retour à la connexion
                  </a>
                </p>
              </div>
            ) : null}

            {panel === "succes" ? (
              <div className="panel-v">
                <PanelTitle id="t-succes" focus={focusPanel}>
                  Mot de passe modifié
                </PanelTitle>
                <Alert tone="success" icon="check" role="status">
                  Mot de passe modifié. Toutes vos sessions ouvertes ont été fermées.
                </Alert>
                <Button
                  className="btn-connexion"
                  onClick={() => {
                    setArrival("mot-de-passe-modifie");
                    show("login");
                  }}
                >
                  Aller à la connexion
                </Button>
              </div>
            ) : null}

            <p className="auth-foot">Prototype d’aide à la décision — non certifié. © 2026 PanoraDent AI.</p>
          </div>

          <aside className="auth-photo" aria-labelledby="side-t">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/medias/connexion/login-praticien.webp"
              width="1824"
              height="1344"
              alt="Praticienne de profil, assise à son poste dans un cabinet dentaire moderne, qui examine une radiographie panoramique affichée sur son écran. Image générée par IA."
            />
            <div className="photo-msg">
              <h2 id="side-t">
                Votre seconde lecture,
                <br />
                sous contrôle
              </h2>
              <p>Détection et numérotation des anomalies sur radiographies panoramiques. Le praticien garde la décision.</p>
              <Link href="/">Découvrir la plateforme ›</Link>
            </div>
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
          </aside>
        </div>
      </main>
    </div>
  );
}
