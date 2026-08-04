import { pluralize } from "@/shared/lib";

import { isMockAnalysis } from "../model/analysis";
import styles from "./AnalysisSummary.module.css";

/** Ligne de métadonnées d'une analyse : volume, modèle, mode d'inférence. */
export function AnalysisSummary({ analysis }) {
  const count = analysis.detections?.length ?? 0;

  return (
    <p className={styles.summary}>
      {pluralize(count, "détection")} · modèle {analysis.modelVersion}{" "}
      <span className={isMockAnalysis(analysis) ? styles.mock : styles.real}>
        ({analysis.inferenceMode})
      </span>
    </p>
  );
}
