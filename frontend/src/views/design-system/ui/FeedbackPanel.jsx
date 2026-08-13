import { ImageOff, Info, ScanLine, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Progress,
  Separator,
  Skeleton,
  Spinner,
} from "@/shared/ui";

import { Canvas, Code, Section, Specimen } from "./Section";

export function FeedbackPanel() {
  return (
    <div className="space-y-10">
      <Section
        title="Alertes"
        description={
          <>
            Messages contextuels, ancrés dans la page. <Code>warning</Code>{" "}
            signale une dégradation attendue, <Code>destructive</Code> un échec
            d&apos;action.
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Alert>
            <Info aria-hidden="true" />
            <AlertTitle>Analyse terminée</AlertTitle>
            <AlertDescription>
              12 détections proposées par le modèle mock-0.0.0.
            </AlertDescription>
          </Alert>

          <Alert variant="warning">
            <ImageOff aria-hidden="true" />
            <AlertTitle>Image non affichable</AlertTitle>
            <AlertDescription>
              L&apos;URL présignée pointe vers l&apos;hôte interne du stockage objet.
            </AlertDescription>
          </Alert>

          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>Échec de l&apos;analyse</AlertTitle>
            <AlertDescription>
              Backend injoignable. Vérifiez que la stack est démarrée.
            </AlertDescription>
          </Alert>

          <Alert variant="success">
            <Info aria-hidden="true" />
            <AlertTitle>Rapport généré</AlertTitle>
            <AlertDescription>Le PDF est disponible pendant une heure.</AlertDescription>
          </Alert>
        </div>
      </Section>

      <Separator />

      <Section
        title="Notifications"
        description={
          <>
            <Code>sonner</Code> — messages éphémères pour confirmer une action
            déjà faite. Jamais pour une information que l&apos;utilisateur doit
            pouvoir relire : elles disparaissent. Le point de rendu unique est
            monté dans <Code>AppProvider</Code>.
          </>
        }
      >
        <Canvas>
          <Specimen label="succès">
            <Button
              variant="outline"
              onClick={() => toast.success("Rapport PDF généré")}
            >
              Succès
            </Button>
          </Specimen>
          <Specimen label="erreur">
            <Button
              variant="outline"
              onClick={() =>
                toast.error("Échec de l'analyse", {
                  description: "Backend injoignable.",
                })
              }
            >
              Erreur
            </Button>
          </Specimen>
          <Specimen label="avertissement">
            <Button
              variant="outline"
              onClick={() =>
                toast.warning("Mode mock", {
                  description: "Les détections affichées sont factices.",
                })
              }
            >
              Avertissement
            </Button>
          </Specimen>
          <Specimen label="avec action">
            <Button
              variant="outline"
              onClick={() =>
                toast("Analyse enregistrée", {
                  action: { label: "Annuler", onClick: () => {} },
                })
              }
            >
              Avec action
            </Button>
          </Specimen>
          <Specimen label="promesse">
            <Button
              variant="outline"
              onClick={() =>
                toast.promise(
                  new Promise((resolve) => setTimeout(resolve, 1800)),
                  {
                    loading: "Analyse en cours…",
                    success: "12 détections proposées",
                    error: "Échec de l'analyse",
                  },
                )
              }
            >
              Promesse
            </Button>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Attente"
        description={
          <>
            <Code>Skeleton</Code> réserve la place du contenu à venir et évite le
            saut de mise en page. <Code>Progress</Code> pour un avancement connu,{" "}
            <Code>Spinner</Code> quand la durée est indéterminée.
          </>
        }
      >
        <Canvas className="block space-y-6">
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Téléversement</span>
              <span className="tabular-nums">62 %</span>
            </div>
            <Progress value={62} />
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Analyse en cours…
          </div>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="État vide"
        description={
          <>
            <Code>Empty</Code> occupe la place d&apos;un contenu absent. Il doit
            toujours proposer l&apos;action qui le remplira — sans quoi
            l&apos;utilisateur reste bloqué.
          </>
        }
      >
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScanLine aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Aucune analyse</EmptyTitle>
            <EmptyDescription>
              Importez une panoramique pour lancer une première analyse. Les
              formats DICOM, JPG et PNG sont acceptés.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button>
              <Upload aria-hidden="true" />
              Importer une panoramique
            </Button>
          </EmptyContent>
        </Empty>
      </Section>
    </div>
  );
}
