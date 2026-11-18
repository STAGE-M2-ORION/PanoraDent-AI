import { Icon } from "@/shared/ui";

import { evaluatePassword } from "../model/password-policy";

/**
 * Jauge de robustesse et règles cochées en direct. Les classes `.meter` et
 * `.rules` sont stylées par l'écran qui l'accueille (connexion, profil).
 */
export function PasswordStrength({ value, meterId = "meter-txt", rulesId = "rules" }) {
  const { rules, level, levelLabel } = evaluatePassword(value);
  return (
    <>
      <div className="meter" data-lvl={level}>
        <div className="meter-bar" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <span className="hint" id={meterId} aria-live="polite">
          Robustesse : {levelLabel}
        </span>
      </div>
      <ul className="rules" id={rulesId} aria-label="Règles du mot de passe">
        {rules.map((rule) => (
          <li key={rule.id} className={rule.ok ? "ok" : undefined}>
            <span className="mk">
              <Icon name="check" />
            </span>
            <span>
              {rule.label}
              <span className="sr-only">{rule.ok ? " : respectée" : " : non respectée"}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Champ mot de passe avec bouton Afficher / Masquer. */
export function PasswordInput({ id, value, onChange, visible, onToggle, label = "le mot de passe", ...rest }) {
  return (
    <div className="pw-wrap">
      <input className="input" id={id} type={visible ? "text" : "password"} value={value} onChange={onChange} {...rest} />
      <button type="button" className="pw-toggle" aria-label={visible ? `Masquer ${label}` : `Afficher ${label}`} aria-pressed={visible} onClick={onToggle}>
        <Icon name={visible ? "eyeoff" : "eye"} />
      </button>
    </div>
  );
}
