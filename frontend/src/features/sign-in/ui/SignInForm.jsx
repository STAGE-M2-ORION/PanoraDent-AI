import { useEffect, useRef, useState } from "react";

import { useCurrentUser } from "@/entities/session";
import { PasswordInput } from "@/entities/session";
import { ErrorCode, toAppError } from "@/shared/api";
import { Alert, Button, GoogleMark } from "@/shared/ui";

/** « Réessayez dans 14 min. » → secondes restantes (à défaut, 15 min). */
function lockSeconds(message) {
  const minutes = Number(/(\d+)\s*min/.exec(message ?? "")?.[1]);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60;
}

function Countdown({ seconds, onDone }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) {
      onDone();
      return undefined;
    }
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, onDone]);
  return (
    <span className="countdown">
      {Math.floor(left / 60)} min {String(left % 60).padStart(2, "0")} s
    </span>
  );
}

/** Message d'arrivée sur la page (`?etat=`), avant toute saisie. */
const ARRIVAL = {
  expiree: { tone: "info", icon: "clock", text: "Votre session a expiré. Reconnectez-vous pour reprendre ; vos relectures enregistrées sont conservées." },
  deconnecte: { tone: "success", icon: "check", text: "Vous êtes déconnecté.", role: "status" },
  "mot-de-passe-modifie": { tone: "success", icon: "check", text: "Mot de passe modifié. Connectez-vous avec votre nouveau mot de passe.", role: "status" },
};

/**
 * Connexion par e-mail et mot de passe (et bouton Google, pas encore branché
 * côté serveur). Gère les états de la maquette : erreur, compte verrouillé
 * avec compte à rebours, session expirée, déconnecté, chargement.
 */
export function SignInForm({ arrival, onSignedIn, onForgot }) {
  const { login } = useCurrentUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(() => (ARRIVAL[arrival] ? { kind: "arrival", ...ARRIVAL[arrival] } : null));
  const [invalid, setInvalid] = useState(false);
  const emailRef = useRef(null);

  useEffect(() => {
    setMessage(ARRIVAL[arrival] ? { kind: "arrival", ...ARRIVAL[arrival] } : null);
  }, [arrival]);

  const submit = async (event) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setInvalid(true);
      setMessage({ tone: "danger", icon: "alert", text: "Saisissez votre adresse e-mail et votre mot de passe.", role: "alert" });
      emailRef.current?.focus();
      return;
    }
    setPending(true);
    setMessage(null);
    setInvalid(false);
    try {
      const user = await login(email, password, { remember });
      onSignedIn(user);
    } catch (cause) {
      const error = toAppError(cause);
      setPending(false);
      if (error.code === ErrorCode.LOCKED) {
        setMessage({ kind: "locked", seconds: lockSeconds(error.message) });
      } else if (error.code === ErrorCode.UNAUTHORIZED) {
        setInvalid(true);
        setMessage({ tone: "danger", icon: "alert", text: "Identifiants incorrects. Vérifiez votre e-mail et votre mot de passe. Après 5 échecs, le compte est verrouillé 15 minutes.", role: "alert" });
      } else {
        setMessage({ tone: "danger", icon: "alert", text: error.message, role: "alert" });
      }
    }
  };

  const locked = message?.kind === "locked";

  return (
    <>
      <div aria-live="polite" style={{ display: "grid", gap: "var(--space-3)" }}>
        {message && !locked ? (
          <Alert tone={message.tone} icon={message.icon} title={message.title} role={message.role}>
            {message.text}
          </Alert>
        ) : null}
        {locked ? (
          <Alert tone="warning" icon="lock" title="Compte verrouillé temporairement" role="alert">
            Après 5 échecs de connexion, le compte est verrouillé pendant 15 minutes. Nouvel essai possible dans{" "}
            <Countdown seconds={message.seconds} onDone={() => setMessage(null)} />. Vous pouvez aussi{" "}
            <a
              href="#oubli"
              onClick={(event) => {
                event.preventDefault();
                onForgot(email);
              }}
            >
              réinitialiser votre mot de passe
            </a>
            .
          </Alert>
        ) : null}
      </div>

      <button
        type="button"
        className="btn btn-google"
        disabled={pending}
        onClick={() =>
          setMessage({
            tone: "warning",
            icon: "lock",
            title: "Connexion Google pas encore disponible",
            text: "Ce serveur n’accepte pour l’instant que la connexion par e-mail et mot de passe. Utilisez le formulaire ci-dessous.",
          })
        }
      >
        <GoogleMark />
        <span>Se connecter avec Google</span>
      </button>
      <p className="hint-g">Réservé aux comptes créés par l’administrateur.</p>
      <div className="or-sep">ou avec votre e-mail</div>

      <form onSubmit={submit} noValidate>
        <fieldset disabled={pending || locked}>
          <div className="field">
            <label className="label" htmlFor="email">
              Adresse e-mail
            </label>
            <input
              ref={emailRef}
              className="input"
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              aria-invalid={invalid ? "true" : undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="pw">
              Mot de passe
            </label>
            <PasswordInput
              id="pw"
              autoComplete="current-password"
              required
              value={password}
              aria-invalid={invalid ? "true" : undefined}
              onChange={(event) => setPassword(event.target.value)}
              visible={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
            />
          </div>
          <label className="remember" htmlFor="remember">
            <input type="checkbox" id="remember" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Se souvenir de moi
          </label>
          <Button className="btn-connexion" type="submit" lumiere={!pending}>
            {pending ? (
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
      <p className="oubli">
        <a
          href="#oubli"
          onClick={(event) => {
            event.preventDefault();
            onForgot(email);
          }}
        >
          Mot de passe oublié ?
        </a>
      </p>
    </>
  );
}
