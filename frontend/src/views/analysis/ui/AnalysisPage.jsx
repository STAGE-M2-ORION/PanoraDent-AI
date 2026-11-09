import { useState } from "react";

import { RequireAuth, useCurrentUser } from "@/entities/session";
import { UploadAnalysisPanel } from "@/features/upload-analysis";
import { Alert, AlertDescription } from "@/shared/ui";
import { AppHeader } from "@/widgets/app-header";
import { DetectionViewer } from "@/widgets/detection-viewer";

function AnalysisContent() {
  const { can } = useCurrentUser();
  const [analysis, setAnalysis] = useState(null);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <AppHeader />

      {can("analysis:create") ? (
        <UploadAnalysisPanel onAnalysisCreated={setAnalysis} />
      ) : (
        <Alert className="mb-8">
          <AlertDescription>
            Votre rôle est en consultation seule : l&apos;import de panoramiques n&apos;est pas autorisé.
          </AlertDescription>
        </Alert>
      )}

      {analysis && (
        <DetectionViewer analysis={analysis} canGenerateReport={can("report:generate")} />
      )}
    </main>
  );
}

/**
 * Poste de travail : détient l'analyse courante et compose les blocs.
 * Aucune logique métier ni appel API à ce niveau. Réservé aux comptes
 * autorisés à consulter les analyses.
 */
export function AnalysisPage() {
  return (
    <RequireAuth permission="analysis:read">
      <AnalysisContent />
    </RequireAuth>
  );
}
