import styles from "./Button.module.css";

/**
 * @param {"primary"|"secondary"} [props.variant]
 * @param {boolean} [props.isLoading] Désactive le bouton et affiche `loadingLabel`.
 */
export function Button({
  variant = "primary",
  type = "button",
  isLoading = false,
  loadingLabel,
  disabled = false,
  className = "",
  children,
  ...rest
}) {
  const classNames = [styles.button, styles[variant], className].filter(Boolean).join(" ");

  return (
    <button
      type={type}
      className={classNames}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      {isLoading && loadingLabel ? loadingLabel : children}
    </button>
  );
}
