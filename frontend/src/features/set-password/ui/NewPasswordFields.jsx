import { PASSWORD_MIN_LENGTH, evaluatePassword } from "@/shared/lib";
import { Field, PasswordInput } from "@/shared/ui";

/** Barre de robustesse : 4 segments, libellé en clair (jamais la couleur seule). */
export function StrengthMeter({ password, email, id }) {
  const { score, label, problem } = evaluatePassword(password, email);
  return (
    <div className="pw-meter" id={id} data-score={password ? score : undefined}>
      <div className="pw-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={password && score >= n ? "on" : undefined} />
        ))}
      </div>
      <p className="pw-label" aria-live="polite">
        {password ? (
          <>
            Robustesse : <strong>{label}</strong>
            {problem ? ` — ${problem}` : null}
          </>
        ) : (
          `Au moins ${PASSWORD_MIN_LENGTH} caractères. Une phrase de plusieurs mots est plus sûre et plus facile à retenir.`
        )}
      </p>
    </div>
  );
}

/**
 * Deux champs (nouveau mot de passe, confirmation), l'indicateur de
 * robustesse et les règles en clair. Contrôlé : `value = { password, confirm }`.
 * `checkNewPassword(value, email)` donne l'erreur à afficher avant envoi.
 */
export function NewPasswordFields({ value, onChange, email, idPrefix = "np", disabled, error }) {
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value });
  const mismatch = value.confirm && value.password !== value.confirm;
  return (
    <>
      <Field label="Nouveau mot de passe" htmlFor={`${idPrefix}-1`}>
        <PasswordInput
          id={`${idPrefix}-1`}
          autoComplete="new-password"
          value={value.password}
          onChange={set("password")}
          disabled={disabled}
          required
          invalid={Boolean(error)}
          aria-describedby={`${idPrefix}-meter ${idPrefix}-rules`}
        />
      </Field>
      <StrengthMeter password={value.password} email={email} id={`${idPrefix}-meter`} />
      <Field label="Confirmez le mot de passe" htmlFor={`${idPrefix}-2`} error={mismatch ? "Les deux mots de passe ne correspondent pas." : null} errorId={`${idPrefix}-2-err`}>
        <PasswordInput
          id={`${idPrefix}-2`}
          autoComplete="new-password"
          value={value.confirm}
          onChange={set("confirm")}
          disabled={disabled}
          required
          invalid={mismatch}
          aria-describedby={mismatch ? `${idPrefix}-2-err` : undefined}
        />
      </Field>
      <ul className="pw-rules" id={`${idPrefix}-rules`}>
        <li>{PASSWORD_MIN_LENGTH} caractères au moins ; aucun caractère spécial n’est imposé.</li>
        <li>Évitez votre adresse e-mail et les suites répétitives.</li>
      </ul>
    </>
  );
}

/** Erreur bloquante avant envoi, ou `null`. Le serveur revérifie de toute façon. */
export function checkNewPassword(value, email) {
  const { valid, problem } = evaluatePassword(value.password, email);
  if (!valid) return problem;
  if (value.password !== value.confirm) return "Les deux mots de passe ne correspondent pas.";
  return null;
}
