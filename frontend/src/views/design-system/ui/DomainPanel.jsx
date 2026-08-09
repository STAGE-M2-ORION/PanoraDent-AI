import { AnalysisSummary } from "@/entities/analysis";
import {
  DetectionLabel,
  detectionColor,
  detectionLabelText,
  isAnomaly,
} from "@/entities/detection";
import { SystemStatusLine } from "@/entities/system-status";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";

import { Canvas, Section } from "./Section";

const CLASSES = Object.values(DetectionLabel);

/** Analyses fictives : cette page ne doit toucher ni à l'API ni au stockage. */
const MOCK_ANALYSIS = {
  id: "demo",
  modelVersion: "mock-0.0.0",
  inferenceMode: "mock",
  detections: new Array(12).fill(null),
};

const REAL_ANALYSIS = {
  id: "demo",
  modelVersion: "yolov11-dentex-1.0.0",
  inferenceMode: "real",
  detections: new Array(8).fill(null),
};

const ONLINE_STATUS = {
  isOnline: true,
  backendStatus: "ok",
  inferenceReachable: true,
  inferenceMode: "mock",
};

const REAL_STATUS = {
  isOnline: true,
  backendStatus: "ok",
  inferenceReachable: true,
  inferenceMode: "real",
};

const OFFLINE_PREVIEW = {
  isOnline: false,
  backendStatus: "backend indisponible",
  inferenceReachable: false,
  inferenceMode: null,
};

/** Boîtes schématiques, dans le style exact du canvas d'analyse. */
function AnnotationPreview() {
  const boxes = [
    { x: 40, y: 60, w: 46, h: 60, label: "Dent · #11 · 94 %", anomaly: false },
    { x: 104, y: 56, w: 46, h: 64, label: "Dent · #12 · 91 %", anomaly: false },
    { x: 168, y: 62, w: 46, h: 58, label: "Carie · #13 · 72 %", anomaly: true },
    { x: 232, y: 58, w: 46, h: 62, label: "Dent · #14 · 88 %", anomaly: false },
  ];

  return (
    <svg
      viewBox="0 0 340 170"
      className="w-full max-w-xl rounded-md border bg-muted"
      role="img"
      aria-label="Aperçu du style d'annotation : boîtes vertes pour les dents, rouges pour les anomalies"
    >
      {boxes.map((box) => {
        const color = box.anomaly
          ? "var(--detection-anomaly)"
          : "var(--detection-normal)";

        return (
          <g key={box.label}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              fill="none"
              stroke={color}
              strokeWidth="2"
            />
            <text x={box.x} y={box.y - 5} fill={color} fontSize="9">
              {box.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function DomainPanel() {
  return (
    <div className="space-y-10">
      <Section
        title="Classes de détection"
        description="Périmètre défini par `inference/app/config.py`. L'ordre fait foi : c'est l'index de classe renvoyé par le modèle. Toute évolution doit être répercutée dans `entities/detection`."
      >
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classe (API)</TableHead>
                <TableHead>Libellé affiché</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Couleur de tracé</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CLASSES.map((label) => (
                <TableRow key={label}>
                  <TableCell className="font-mono text-xs">{label}</TableCell>
                  <TableCell>{detectionLabelText(label)}</TableCell>
                  <TableCell>
                    <Badge variant={isAnomaly(label) ? "destructive" : "secondary"}>
                      {isAnomaly(label) ? "anomalie" : "normal"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-full border"
                        style={{ background: detectionColor(label) }}
                      />
                      <code className="font-mono text-xs">
                        {detectionColor(label)}
                      </code>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Alert variant="warning">
          <AlertTitle>Double source de vérité assumée</AlertTitle>
          <AlertDescription>
            Ces hexadécimaux vivent dans `entities/detection`, en parallèle des
            jetons `--detection-normal` / `--detection-anomaly`. Le canvas ne lit
            pas les variables CSS : les deux doivent être modifiés ensemble.
          </AlertDescription>
        </Alert>
      </Section>

      <Separator />

      <Section
        title="Style d'annotation"
        description="Rendu réel du viewer : boîte de 2 px, légende posée juste au-dessus, aucun remplissage pour ne pas masquer le cliché."
      >
        <Canvas>
          <AnnotationPreview />
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Bandeau d'état"
        description="Composant `SystemStatusLine`. Le mode mock doit rester visuellement impossible à confondre avec une inférence réelle."
      >
        <Canvas className="block space-y-4">
          <SystemStatusLine status={ONLINE_STATUS} />
          <SystemStatusLine status={REAL_STATUS} />
          <SystemStatusLine status={OFFLINE_PREVIEW} />
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Résumé d'analyse"
        description="Composant `AnalysisSummary`, affiché sous le titre du viewer."
      >
        <Canvas className="block space-y-4 text-sm text-muted-foreground">
          <AnalysisSummary analysis={MOCK_ANALYSIS} />
          <AnalysisSummary analysis={REAL_ANALYSIS} />
        </Canvas>
      </Section>
    </div>
  );
}
