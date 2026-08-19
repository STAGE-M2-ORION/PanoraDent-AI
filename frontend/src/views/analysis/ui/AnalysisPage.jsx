import { useState } from "react";

import { UploadAnalysisPanel } from "@/features/upload-analysis";
import { AppHeader } from "@/widgets/app-header";
import { DetectionViewer } from "@/widgets/detection-viewer";

/**
 * Poste de travail : détient l'analyse courante et compose les blocs.
 * Aucune logique métier ni appel API à ce niveau.
 */
export function AnalysisPage() {
  const [analysis, setAnalysis] = useState(null);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <AppHeader />
      <UploadAnalysisPanel onAnalysisCreated={setAnalysis} />
      {analysis && <DetectionViewer analysis={analysis} />}
    </main>
  );
}
