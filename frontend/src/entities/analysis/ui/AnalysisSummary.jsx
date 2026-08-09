import { pluralize } from "@/shared/lib";
import { Badge } from "@/shared/ui";

import { isMockAnalysis } from "../model/analysis";

/** Ligne de métadonnées d'une analyse : volume, modèle, mode d'inférence. */
export function AnalysisSummary({ analysis }) {
  const count = analysis.detections?.length ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{pluralize(count, "détection")}</span>
      <span aria-hidden="true">·</span>
      <span>
        modèle <code className="font-mono text-xs">{analysis.modelVersion}</code>
      </span>
      <Badge variant={isMockAnalysis(analysis) ? "warning" : "secondary"}>
        {analysis.inferenceMode}
      </Badge>
    </div>
  );
}
