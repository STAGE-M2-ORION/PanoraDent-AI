import { ImageOff } from "lucide-react";
import { useEffect, useRef } from "react";

import { AnalysisSummary } from "@/entities/analysis";
import { GenerateReportButton } from "@/features/generate-report";
import { cn } from "@/shared/lib";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/shared/ui";

import { drawDetections } from "../lib/draw-detections";
import { ImageStatus, useAnalysisImage } from "../model/use-analysis-image";

export function DetectionViewer({ analysis }) {
  const canvasRef = useRef(null);
  const { image, status } = useAnalysisImage(analysis.id);

  useEffect(() => {
    if (!image || !canvasRef.current) return;
    drawDetections(canvasRef.current, image, analysis.detections);
  }, [image, analysis.detections]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Détections proposées</CardTitle>
        <CardDescription>
          <AnalysisSummary analysis={analysis} />
        </CardDescription>
      </CardHeader>

      <CardContent>
        {status === ImageStatus.LOADING && (
          <Skeleton className="aspect-2/1 w-full rounded-md" />
        )}

        {status === ImageStatus.UNAVAILABLE && (
          <Alert variant="warning">
            <ImageOff aria-hidden="true" />
            <AlertTitle>Image non affichable</AlertTitle>
            <AlertDescription>
              L&apos;URL présignée pointe vers l&apos;hôte interne du stockage objet.
              L&apos;analyse et le rapport PDF restent générés côté serveur.
            </AlertDescription>
          </Alert>
        )}

        {/*
          Le canvas reste monté en permanence : l'effet de dessin s'exécute dès
          que l'image est prête, sans dépendre de l'ordre de rendu.
        */}
        <canvas
          ref={canvasRef}
          className={cn(
            "block h-auto max-w-full rounded-md border bg-muted",
            status !== ImageStatus.READY && "hidden"
          )}
        />

        <GenerateReportButton analysisId={analysis.id} />
      </CardContent>
    </Card>
  );
}
