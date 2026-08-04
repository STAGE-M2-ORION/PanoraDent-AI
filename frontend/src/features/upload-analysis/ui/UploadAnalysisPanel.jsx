import { Alert, FilePicker } from "@/shared/ui";

import { useUploadAnalysis } from "../model/use-upload-analysis";
import styles from "./UploadAnalysisPanel.module.css";

const ACCEPTED_FORMATS = ".dcm,image/*";

export function UploadAnalysisPanel({ onAnalysisCreated }) {
  const { upload, isPending, error } = useUploadAnalysis(onAnalysisCreated);

  return (
    <section className={styles.panel}>
      <FilePicker accept={ACCEPTED_FORMATS} onSelect={upload} disabled={isPending}>
        {isPending ? "Analyse en cours…" : "Importer une panoramique (DICOM / JPG / PNG)"}
      </FilePicker>
      {error && <Alert tone="danger">Échec de l&apos;analyse : {error.message}</Alert>}
    </section>
  );
}
