import Link from "next/link";
import { useRef, useState } from "react";

import { toAppError } from "@/shared/api";
import { Alert, Button } from "@/shared/ui";

import { NewPasswordFields, checkNewPassword } from "./NewPasswordFields";

/**
 * Formulaire commun aux pages atteintes par un lien reçu par e-mail
 * (nouveau mot de passe, première connexion).
 *
 * - `submit(password)` appelle le serveur ; en cas de succès la session est
 *   ouverte côté serveur et `onDone()` prend la suite ;
 * - un lien inexistant, expiré ou déjà utilisé (`lien_invalide`) bascule sur
 *   un état qui propose d'en redemander un, plutôt qu'une impasse.
 */
export function LinkPasswordForm({ token, submit, onDone, submitLabel, renewHint }) {
  const [value, setValue] = useState({ password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [linkInvalid, setLinkInvalid] = useState(!token);
  const errorRef = useRef(null);

  const onSubmit = async (event) => {
    event.preventDefault();
    const problem = checkNewPassword(value);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submit(value.password);
      await onDone();
    } catch (cause) {
      const e = toAppError(cause);
      if (e.serverCode === "lien_invalide") setLinkInvalid(true);
      else setError(e.message);
      setBusy(false);
    }
  };

  if (linkInvalid) {
    return (
      <div className="auth-done" aria-live="polite">
        <Alert tone="danger" icon="alert" title="Ce lien n’est plus valable" data-erreur="lien_invalide">
          Il a expiré, a déjà servi ou n’existe pas. {renewHint}
        </Alert>
        <div className="btn-row">
          <Button href="/mot-de-passe-oublie">Demander un nouveau lien</Button>
          <Button href="/connexion" variant="ghost">
            Retour à la connexion
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} aria-label={submitLabel}>
      <fieldset disabled={busy}>
        <div aria-live="polite" ref={errorRef}>
          {error ? (
            <Alert tone="danger" icon="alert" role="alert">
              {error}
            </Alert>
          ) : null}
        </div>
        <NewPasswordFields value={value} onChange={setValue} disabled={busy} error={error} />
        <Button type="submit" className="btn-block" disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Enregistrement…
            </>
          ) : (
            submitLabel
          )}
        </Button>
        <p className="hint" style={{ margin: 0 }}>
          <Link className="auth-link" href="/connexion">
            Retour à la connexion
          </Link>
        </p>
      </fieldset>
    </form>
  );
}
