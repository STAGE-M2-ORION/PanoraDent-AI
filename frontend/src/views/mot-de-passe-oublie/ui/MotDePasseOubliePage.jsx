import Link from "next/link";
import { useState } from "react";

import { requestPasswordReset } from "@/entities/session";
import { ErrorCode, toAppError } from "@/shared/api";
import { Alert, Button, Field, Input } from "@/shared/ui";
import { AuthCard } from "@/widgets/auth-card";

/**
 * Mot de passe oublié : un champ, un bouton, et TOUJOURS la même
 * confirmation — le message ne varie pas selon que le compte existe ou non.
 * Seule une panne réseau (le serveur n'a rien reçu) s'affiche autrement.
 */
export function MotDePasseOubliePage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (cause) {
      const e = toAppError(cause);
      if (e.code === ErrorCode.NETWORK || e.code === ErrorCode.TIMEOUT) setError(e.message);
      else setSent(true); // aucune réponse ne doit distinguer les adresses
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard docTitle="Mot de passe oublié">
      <div className="panel-v">
        <h1>Mot de passe oublié</h1>
        <p className="sous">Saisissez l’adresse e-mail de votre compte : nous vous enverrons un lien pour choisir un nouveau mot de passe.</p>

        <div className="auth-notices" aria-live="polite" aria-atomic="true">
          {sent ? (
            <Alert tone="success" icon="mail" title="Vérifiez votre messagerie" data-etat="envoye">
              Si un compte existe pour cette adresse, un lien vient d’être envoyé. Il est valable une heure et ne sert qu’une fois.
            </Alert>
          ) : null}
          {error ? (
            <Alert tone="danger" icon="alert">
              {error}
            </Alert>
          ) : null}
        </div>

        {sent ? (
          <div className="btn-row">
            <Button href="/connexion">Retour à la connexion</Button>
            <Button variant="ghost" onClick={() => setSent(false)}>
              Renvoyer un lien
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} aria-label="Demande de réinitialisation">
            <fieldset disabled={busy}>
              <Field label="Adresse e-mail" htmlFor="o-email">
                <Input id="o-email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Button type="submit" className="btn-block" disabled={busy}>
                {busy ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Envoi…
                  </>
                ) : (
                  "Recevoir un lien"
                )}
              </Button>
              <p className="hint" style={{ margin: 0 }}>
                <Link className="auth-link" href="/connexion">
                  Retour à la connexion
                </Link>
              </p>
            </fieldset>
          </form>
        )}
        <p className="hint-g">Vous vous connectez avec Google ? Ce mot de passe est celui de votre compte Google : récupérez-le auprès de Google.</p>
      </div>
    </AuthCard>
  );
}
