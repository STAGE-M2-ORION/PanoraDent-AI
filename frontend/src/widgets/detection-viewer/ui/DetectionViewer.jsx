import { useEffect, useRef } from "react";

import { AnalysisSummary } from "@/entities/analysis";
import { GenerateReportButton } from "@/features/generate-report";
import { Alert, Card } from "@/shared/ui";

import { drawDetections } from "../lib/draw-detections";
import { ImageStatus, useAnalysisImage } from "../model/use-analysis-image";
import styles from "./DetectionViewer.module.css";

export function DetectionViewer({ analysis }) {
  const canvasRef = useRef(null);
  const { image, status } = useAnalysisImage(analysis.id);

  useEffect(() => {
    if (!image || !canvasRef.current) return;
    drawDetections(canvasRef.current, image, analysis.detections);
  }, [image, analysis.detections]);

  return (
    <Card title="Détections proposées">
      <AnalysisSummary analysis={analysis} />

      {status === ImageStatus.UNAVAILABLE ? (
        <Alert tone="warning">
          Image non affichable : l&apos;URL présignée pointe vers l&apos;hôte interne du
          stockage objet. L&apos;analyse et le rapport PDF restent générés côté serveur.
        </Alert>
      ) : (
        <canvas ref={canvasRef} className={styles.canvas} />
      )}

      <GenerateReportButton analysisId={analysis.id} />
    </Card>
  );
}
