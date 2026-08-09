import { LoaderCircle, TriangleAlert, Upload } from "lucide-react";

import { Alert, AlertDescription, AlertTitle, FilePicker } from "@/shared/ui";

import { useUploadAnalysis } from "../model/use-upload-analysis";

const ACCEPTED_FORMATS = ".dcm,image/*";

export function UploadAnalysisPanel({ onAnalysisCreated }) {
  const { upload, isPending, error } = useUploadAnalysis(onAnalysisCreated);

  return (
    <section className="mb-8">
      <FilePicker
        accept={ACCEPTED_FORMATS}
        onSelect={upload}
        disabled={isPending}
        size="lg"
      >
        {isPending ? (
          <>
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            Analyse en cours…
          </>
        ) : (
          <>
            <Upload aria-hidden="true" />
            Importer une panoramique (DICOM / JPG / PNG)
          </>
        )}
      </FilePicker>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Échec de l&apos;analyse</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
