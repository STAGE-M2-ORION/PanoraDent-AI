import { Activity, TriangleAlert } from "lucide-react";

import { cn } from "@/shared/lib";
import { Badge } from "@/shared/ui";

import { isMockInference } from "../model/system-status";

/** Bandeau d'état : backend, mode d'inférence, avertissement en mode mock. */
export function SystemStatusLine({ status, className }) {
  if (!status) return null;

  const isMock = isMockInference(status);

  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-sm", className)}>
      <Badge variant={status.isOnline ? "success" : "destructive"}>
        <Activity aria-hidden="true" />
        Backend : {status.backendStatus}
      </Badge>

      <Badge variant={isMock ? "warning" : "secondary"}>
        Inférence : {status.inferenceMode || "?"}
      </Badge>

      {isMock && (
        <span className="inline-flex items-center gap-1.5 text-warning">
          <TriangleAlert className="size-3.5" aria-hidden="true" />
          détections factices — aucun modèle entraîné
        </span>
      )}
    </div>
  );
}
