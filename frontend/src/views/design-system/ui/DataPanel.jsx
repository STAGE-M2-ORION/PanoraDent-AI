import { ChevronsUpDown, FileText, Image as ImageIcon, ScanLine } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  Separator,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";

import { Canvas, Code, Section, Specimen } from "./Section";

const DETECTIONS = [
  { label: "Dent", fdi: "11", confidence: 94, anomaly: false },
  { label: "Carie profonde", fdi: "11", confidence: 72, anomaly: true },
  { label: "Dent", fdi: "12", confidence: 91, anomaly: false },
  { label: "Lésion périapicale", fdi: "—", confidence: 58, anomaly: true },
];

const CHART_DATA = [
  { classe: "Dent", detections: 12 },
  { classe: "Carie", detections: 4 },
  { classe: "Carie prof.", detections: 2 },
  { classe: "Lésion", detections: 3 },
  { classe: "Incluse", detections: 1 },
];

const CHART_CONFIG = {
  detections: { label: "Détections", color: "var(--chart-1)" },
};

export function DataPanel() {
  return (
    <div className="space-y-10">
      <Section
        title="Tableau"
        description="Support de la liste des détections. Les colonnes numériques sont alignées à droite et en chiffres tabulaires, pour que les décimales s'empilent."
      >
        <div className="rounded-lg border bg-card">
          <Table>
            <TableCaption className="pb-4">
              Détections proposées pour l&apos;analyse courante.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Classe</TableHead>
                <TableHead>FDI</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead className="text-right">Confiance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DETECTIONS.map((detection) => (
                <TableRow key={`${detection.label}-${detection.fdi}`}>
                  <TableCell>{detection.label}</TableCell>
                  <TableCell className="font-mono text-xs">{detection.fdi}</TableCell>
                  <TableCell>
                    <Badge variant={detection.anomaly ? "destructive" : "secondary"}>
                      {detection.anomaly ? "anomalie" : "normal"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {detection.confidence} %
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Separator />

      <Section
        title="Cartes"
        description={
          <>
            Conteneur de premier niveau. <Code>CardAction</Code> se place dans
            l&apos;en-tête, aligné à droite du titre.
          </>
        }
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
              <FileText aria-hidden="true" />
              Générer le rapport PDF
            </Button>
          </CardFooter>
        </Card>
      </Section>

      <Separator />

      <Section
        title="Listes d'éléments"
        description={
          <>
            <Code>Item</Code> structure une ligne riche — média, titre,
            description, actions — sans retomber sur un tableau.
          </>
        }
      >
        <ItemGroup className="max-w-xl rounded-lg border bg-card">
          <Item>
            <ItemMedia variant="icon">
              <ScanLine aria-hidden="true" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Panoramique du 12/03</ItemTitle>
              <ItemDescription>12 détections · mock-0.0.0</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button variant="ghost" size="sm">
                Ouvrir
              </Button>
            </ItemActions>
          </Item>
          <ItemSeparator />
          <Item>
            <ItemMedia variant="icon">
              <ImageIcon aria-hidden="true" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Panoramique du 09/03</ItemTitle>
              <ItemDescription>8 détections · mock-0.0.0</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button variant="ghost" size="sm">
                Ouvrir
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </Section>

      <Separator />

      <Section
        title="Graphique"
        description={
          <>
            <Code>ChartContainer</Code> enveloppe Recharts et injecte les couleurs
            depuis les jetons : la palette suit donc le thème, y compris en
            sombre.
          </>
        }
      >
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Répartition par classe</CardTitle>
            <CardDescription>Données fictives, à titre d&apos;illustration</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={CHART_CONFIG} className="h-[240px] w-full">
              <BarChart data={CHART_DATA} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="classe" tickLine={false} axisLine={false} tickMargin={8} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                {/*
                  Animation désactivée : sur une page de référence, le graphique
                  doit être lisible dès le premier rendu, y compris en capture.
                */}
                <Bar
                  dataKey="detections"
                  fill="var(--color-detections)"
                  radius={4}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </Section>

      <Separator />

      <Section
        title="Contenu repliable"
        description={
          <>
            <Code>Accordion</Code> pour une liste de sections dont une seule
            s&apos;ouvre ; <Code>Collapsible</Code> pour un unique bloc de détail.
          </>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Accordion type="single" collapsible className="rounded-lg border bg-card px-4">
            <AccordionItem value="anonymisation">
              <AccordionTrigger>Anonymisation</AccordionTrigger>
              <AccordionContent>
                Les tags DICOM identifiants sont écrasés et l&apos;EXIF supprimé
                avant tout stockage. Seuls les pixels sont conservés.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="inference">
              <AccordionTrigger>Inférence</AccordionTrigger>
              <AccordionContent>
                Le service tourne en mode mock tant qu&apos;aucun modèle entraîné
                n&apos;est déposé : les détections sont factices.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="rapport">
              <AccordionTrigger>Rapport</AccordionTrigger>
              <AccordionContent>
                Le PDF reprend l&apos;image annotée, le tableau des détections et
                la mention légale obligatoire.
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <Collapsible className="h-fit rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">Métadonnées techniques</span>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Afficher les métadonnées">
                  <ChevronsUpDown aria-hidden="true" />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="mt-3 space-y-1 font-mono text-xs text-muted-foreground">
              <p>image_key : images/9f1c….png</p>
              <p>width × height : 1024 × 512</p>
              <p>model_version : mock-0.0.0</p>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </Section>

      <Separator />

      <Section
        title="Carrousel"
        description="Défilement horizontal d'éléments de même nature — par exemple plusieurs clichés d'un même patient."
      >
        <Carousel className="mx-auto w-full max-w-md">
          <CarouselContent>
            {[1, 2, 3, 4].map((index) => (
              <CarouselItem key={index} className="basis-1/2">
                <div className="flex aspect-2/1 items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground">
                  Cliché {index}
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </Section>

      <Separator />

      <Section
        title="Zone défilante"
        description={
          <>
            <Code>ScrollArea</Code> remplace la barre de défilement native par une
            version stylée, cohérente entre navigateurs.
          </>
        }
      >
        <Canvas className="items-start">
          <Specimen label="ScrollArea">
            <ScrollArea className="h-48 w-72 rounded-lg border bg-card p-4">
              <div className="space-y-2 text-sm">
                {Array.from({ length: 16 }, (_, index) => (
                  <p key={index} className="text-muted-foreground">
                    Détection #{index + 1} — confiance {90 - index * 2} %
                  </p>
                ))}
              </div>
            </ScrollArea>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Panneaux redimensionnables"
        description="Utile pour un futur écran de revue : le cliché d'un côté, la liste des détections de l'autre, avec une répartition réglable."
      >
        <ResizablePanelGroup
          direction="horizontal"
          className="h-56 max-w-2xl rounded-lg border"
        >
          <ResizablePanel defaultSize={60}>
            <div className="flex h-full items-center justify-center bg-muted/40 p-4 text-sm text-muted-foreground">
              Panoramique
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={40}>
            <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
              Détections
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </Section>
    </div>
  );
}
