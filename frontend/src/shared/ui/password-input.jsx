import { forwardRef, useState } from "react";

import { cx } from "../lib/cx";
import { Icon } from "./icon";

/**
 * Champ mot de passe avec bouton « Afficher / Masquer ». Le bouton est un vrai
 * bouton (au clavier), annoncé par son libellé, et ne soumet pas le formulaire.
 */
export const PasswordInput = forwardRef(function PasswordInput({ className, invalid, ...rest }, ref) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "Masquer le mot de passe" : "Afficher le mot de passe";
  return (
    <div className="pw-field">
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        className={cx("input", className)}
        aria-invalid={invalid ? "true" : undefined}
        spellCheck={false}
        autoCapitalize="off"
        {...rest}
      />
      <button type="button" className="pw-toggle" aria-label={label} title={label} aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
        <Icon name={visible ? "eye-off" : "eye"} />
      </button>
    </div>
  );
});
