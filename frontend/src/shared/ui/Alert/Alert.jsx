import styles from "./Alert.module.css";

/**
 * @param {"info"|"warning"|"danger"} [props.tone]
 */
export function Alert({ tone = "info", className = "", children }) {
  const classNames = [styles.alert, styles[tone], className].filter(Boolean).join(" ");
  const role = tone === "danger" ? "alert" : "status";

  return (
    <p className={classNames} role={role}>
      {children}
    </p>
  );
}
