import { Alert, Button } from "@/shared/ui";

import { useGenerateReport } from "../model/use-generate-report";
import styles from "./GenerateReportButton.module.css";

export function GenerateReportButton({ analysisId }) {
  const { generate, reportUrl, isPending, error } = useGenerateReport(analysisId);

  return (
    <div className={styles.wrapper}>
      <div className={styles.actions}>
        <Button onClick={generate} isLoading={isPending} loadingLabel="Génération…">
          Générer le rapport PDF
        </Button>
        {reportUrl && (
          <a className={styles.link} href={reportUrl} target="_blank" rel="noreferrer">
            Ouvrir le rapport
          </a>
        )}
      </div>
      {error && <Alert tone="danger">Échec de la génération : {error.message}</Alert>}
    </div>
  );
}
