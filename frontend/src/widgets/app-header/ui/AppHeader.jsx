import { SystemStatusLine, useSystemStatus } from "@/entities/system-status";

import styles from "./AppHeader.module.css";

export function AppHeader() {
  const status = useSystemStatus();

  return (
    <header className={styles.header}>
      <h1 className={styles.title}>PanoraDent AI</h1>
      <p className={styles.subtitle}>
        Aide au diagnostic — prototype de recherche non certifié.
      </p>
      <SystemStatusLine status={status} />
    </header>
  );
}
