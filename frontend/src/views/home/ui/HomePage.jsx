import { useState } from "react";

import { UploadAnalysisPanel } from "@/features/upload-analysis";
import { AppHeader } from "@/widgets/app-header";
import { DetectionViewer } from "@/widgets/detection-viewer";

import styles from "./HomePage.module.css";

/**
 * Page unique : détient l'analyse courante et compose les blocs.
 * Aucune logique métier ni appel API à ce niveau.
 */
export function HomePage() {
  const [analysis, setAnalysis] = useState(null);

  return (
    <main className={styles.page}>
      <AppHeader />
      <UploadAnalysisPanel onAnalysisCreated={setAnalysis} />
      {analysis && <DetectionViewer analysis={analysis} />}
    </main>
  );
}
