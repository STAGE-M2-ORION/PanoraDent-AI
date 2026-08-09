import {
  ExternalLink,
  FileDown,
  ImageOff,
  Info,
  LoaderCircle,
  TriangleAlert,
  Upload,
} from "lucide-react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FilePicker,
  Input,
  Label,
  Progress,
  Separator,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui";

import { Canvas, Section, Specimen } from "./Section";

const BUTTON_VARIANTS = ["default", "secondary", "outline", "ghost", "link", "destructive"];
const BUTTON_SIZES = ["sm", "default", "lg", "icon"];
const BADGE_VARIANTS = ["default", "secondary", "outline", "warning", "success", "destructive"];

export function ComponentsPanel() {
  return (
    <div className="space-y-10">
      <Section
        title="Boutons"
        description="Composant shadcn `button`. `default` porte l'action principale d'un écran — un seul à la fois. Les icônes se placent avant le libellé et sont dimensionnées automatiquement."
      >
        <Canvas>
          {BUTTON_VARIANTS.map((variant) => (
            <Specimen key={variant} label={variant}>
              <Button variant={variant}>Générer</Button>
            </Specimen>
          ))}
        </Canvas>

        <Canvas>
          {BUTTON_SIZES.map((size) => (
            <Specimen key={size} label={size}>
              <Button size={size} aria-label={size === "icon" ? "Télécharger" : undefined}>
                <FileDown aria-hidden="true" />
                {size !== "icon" && "Rapport PDF"}
              </Button>
            </Specimen>
          ))}
        </Canvas>

        <Canvas>
          <Specimen label="disabled">
            <Button disabled>
              <FileDown aria-hidden="true" />
              Rapport PDF
            </Button>
          </Specimen>
          <Specimen label="chargement">
            <Button disabled>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Génération…
            </Button>
          </Specimen>
          <Specimen label="asChild — lien">
            <Button asChild variant="link">
              <a href="#composants">
                Ouvrir le rapport
                <ExternalLink aria-hidden="true" />
              </a>
            </Button>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Sélecteur de fichier"
        description="Composant maison : shadcn n'en fournit pas. Un label stylé comme un bouton masque l'input, qui reste atteignable au clavier (`sr-only`, pas `display:none`)."
      >
        <Canvas>
          <Specimen label="au repos">
            <FilePicker accept=".dcm,image/*" onSelect={() => {}} size="lg">
              <Upload aria-hidden="true" />
              Importer une panoramique
            </FilePicker>
          </Specimen>
          <Specimen label="pendant l'analyse">
            <FilePicker accept=".dcm,image/*" onSelect={() => {}} size="lg" disabled>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Analyse en cours…
            </FilePicker>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Badges"
        description="Étiquettes d'état, jamais cliquables ici. `warning` et `success` sont des variantes ajoutées au composant shadcn pour les besoins du prototype."
      >
        <Canvas>
          {BADGE_VARIANTS.map((variant) => (
            <Specimen key={variant} label={variant}>
              <Badge variant={variant}>mock</Badge>
            </Specimen>
          ))}
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Alertes"
        description="Messages contextuels. `warning` signale une dégradation attendue (image non affichable), `destructive` un échec d'action."
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
        title="Cartes"
        description="Conteneur de premier niveau. `CardAction` se place dans l'en-tête, aligné à droite du titre."
      >
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Détections proposées</CardTitle>
            <CardDescription>12 détections · modèle mock-0.0.0</CardDescription>
            <CardAction>
              <Badge variant="warning">mock</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Skeleton className="aspect-2/1 w-full rounded-md" />
          </CardContent>
          <CardFooter>
            <Button size="sm">
              <FileDown aria-hidden="true" />
              Générer le rapport PDF
            </Button>
          </CardFooter>
        </Card>
      </Section>

      <Separator />

      <Section
        title="Formulaire"
        description="Aucun formulaire n'existe encore dans l'application. Ces primitives sont posées pour la revue praticien à venir."
      >
        <Canvas className="block max-w-sm space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ds-fdi">Numéro FDI</Label>
            <Input id="ds-fdi" placeholder="11" inputMode="numeric" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ds-note">Commentaire</Label>
            <Input id="ds-note" placeholder="Observation du praticien" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ds-invalid">Champ en erreur</Label>
            <Input id="ds-invalid" defaultValue="99" aria-invalid="true" />
          </div>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Tableau"
        description="Utilisé pour la liste des détections. Les colonnes numériques sont alignées à droite."
      >
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classe</TableHead>
                <TableHead>FDI</TableHead>
                <TableHead className="text-right">Confiance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Dent</TableCell>
                <TableCell className="font-mono text-xs">11</TableCell>
                <TableCell className="text-right tabular-nums">94 %</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Carie profonde</TableCell>
                <TableCell className="font-mono text-xs">11</TableCell>
                <TableCell className="text-right tabular-nums">72 %</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Lésion périapicale</TableCell>
                <TableCell className="font-mono text-xs">—</TableCell>
                <TableCell className="text-right tabular-nums">58 %</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Section>

      <Separator />

      <Section
        title="États d'attente"
        description="`Skeleton` réserve la place du contenu à venir, `Progress` sert aux traitements dont on connaît l'avancement."
      >
        <Canvas className="block space-y-4">
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          </div>
          <Progress value={62} />
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Infobulle"
        description="Réservée aux compléments non essentiels : son contenu doit rester facultatif à la compréhension."
      >
        <Canvas>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Mode d&apos;inférence</Button>
            </TooltipTrigger>
            <TooltipContent>
              mock = détections factices, sans valeur diagnostique
            </TooltipContent>
          </Tooltip>
        </Canvas>
      </Section>
    </div>
  );
}
