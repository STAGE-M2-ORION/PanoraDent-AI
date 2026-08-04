import { isMockInference } from "../model/system-status";
import styles from "./SystemStatusLine.module.css";

/** Bandeau d'état : backend, mode d'inférence, avertissement en mode mock. */
export function SystemStatusLine({ status }) {
  if (!status) return null;

  const isMock = isMockInference(status);

  return (
    <small className={isMock ? styles.mock : styles.real}>
      Backend : {status.backendStatus} · Inférence : {status.inferenceMode || "?"}
      {isMock && " (détections factices — aucun modèle entraîné)"}
    </small>
  );
}
