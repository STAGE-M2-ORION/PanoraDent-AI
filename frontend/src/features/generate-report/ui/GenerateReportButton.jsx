import { ExternalLink, FileDown, LoaderCircle, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle, Button } from "@/shared/ui";

import { useGenerateReport } from "../model/use-generate-report";

export function GenerateReportButton({ analysisId }) {
  const { generate, reportUrl, isPending, error } = useGenerateReport(analysisId);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={generate} disabled={isPending}>
          {isPending ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Génération…
            </>
          ) : (
            <>
              <FileDown aria-hidden="true" />
              Générer le rapport PDF
            </>
          )}
        </Button>

        {reportUrl && (
          <Button asChild variant="link">
            <a href={reportUrl} target="_blank" rel="noreferrer">
              Ouvrir le rapport
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Échec de la génération</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
