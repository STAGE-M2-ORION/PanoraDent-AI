import { forwardRef } from "react";

import { cx } from "../lib/cx";

/** Champ : libellé, contrôle, aide et message d'erreur. */
export function Field({ label, htmlFor, hint, error, errorId, className, children, ...rest }) {
  return (
    <div className={cx("field", className)} {...rest}>
      {label ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
      {error ? (
        <p className="error-text" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx("input", className)} aria-invalid={invalid ? "true" : undefined} {...rest} />;
});

export const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx("select", className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx("textarea", className)} {...rest} />;
});
