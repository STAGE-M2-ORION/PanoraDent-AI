import {
  Bold,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileDown,
  Italic,
  LoaderCircle,
  Underline,
} from "lucide-react";

import {
  AspectRatio,
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  Badge,
  Button,
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  Kbd,
  KbdGroup,
  Separator,
  Spinner,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/ui";

import { Canvas, Code, Section, Specimen } from "./Section";

const BUTTON_VARIANTS = ["default", "secondary", "outline", "ghost", "link", "destructive"];
const BUTTON_SIZES = ["sm", "default", "lg", "icon"];
const BADGE_VARIANTS = ["default", "secondary", "outline", "warning", "success", "destructive"];

export function BasePanel() {
  return (
    <div className="space-y-10">
      <Section
        title="Boutons"
        description={
          <>
            Composant shadcn <Code>button</Code>. <Code>default</Code> porte
            l&apos;action principale d&apos;un écran — un seul à la fois. Les icônes
            se placent avant le libellé et sont dimensionnées automatiquement.
          </>
        }
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
              <a href="#base">
                Ouvrir le rapport
                <ExternalLink aria-hidden="true" />
              </a>
            </Button>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Groupes de boutons"
        description={
          <>
            <Code>ButtonGroup</Code> soude des actions liées : les rayons et
            bordures internes sont supprimés automatiquement.
          </>
        }
      >
        <Canvas>
          <Specimen label="horizontal">
            <ButtonGroup>
              <Button variant="outline">Précédent</Button>
              <Button variant="outline">Suivant</Button>
            </ButtonGroup>
          </Specimen>

          <Specimen label="avec libellé et séparateur">
            <ButtonGroup>
              <ButtonGroupText>Export</ButtonGroupText>
              <ButtonGroupSeparator />
              <Button variant="outline">PDF</Button>
              <Button variant="outline">
                <ChevronDown aria-hidden="true" />
              </Button>
            </ButtonGroup>
          </Specimen>

          <Specimen label="vertical">
            <ButtonGroup orientation="vertical">
              <Button variant="outline">Valider</Button>
              <Button variant="outline">Corriger</Button>
              <Button variant="outline">Supprimer</Button>
            </ButtonGroup>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Badges"
        description={
          <>
            Étiquettes d&apos;état, jamais cliquables ici. <Code>warning</Code> et{" "}
            <Code>success</Code> sont des variantes ajoutées au composant shadcn
            pour les besoins du prototype.
          </>
        }
      >
        <Canvas>
          {BADGE_VARIANTS.map((variant) => (
            <Specimen key={variant} label={variant}>
              <Badge variant={variant}>mock</Badge>
            </Specimen>
          ))}
          <Specimen label="avec icône">
            <Badge variant="success">
              <Check aria-hidden="true" />
              validé
            </Badge>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Bascules"
        description={
          <>
            <Code>Toggle</Code> pour un état booléen isolé,{" "}
            <Code>ToggleGroup</Code> pour un choix exclusif ou multiple.
          </>
        }
      >
        <Canvas>
          <Specimen label="Toggle">
            <Toggle aria-label="Gras">
              <Bold aria-hidden="true" />
            </Toggle>
          </Specimen>

          <Specimen label="ToggleGroup — multiple">
            <ToggleGroup type="multiple" variant="outline">
              <ToggleGroupItem value="bold" aria-label="Gras">
                <Bold aria-hidden="true" />
              </ToggleGroupItem>
              <ToggleGroupItem value="italic" aria-label="Italique">
                <Italic aria-hidden="true" />
              </ToggleGroupItem>
              <ToggleGroupItem value="underline" aria-label="Souligné">
                <Underline aria-hidden="true" />
              </ToggleGroupItem>
            </ToggleGroup>
          </Specimen>

          <Specimen label="ToggleGroup — exclusif">
            <ToggleGroup type="single" defaultValue="toutes" variant="outline">
              <ToggleGroupItem value="toutes">Toutes</ToggleGroupItem>
              <ToggleGroupItem value="dents">Dents</ToggleGroupItem>
              <ToggleGroupItem value="anomalies">Anomalies</ToggleGroupItem>
            </ToggleGroup>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Avatars"
        description="Identité d'un praticien. Le repli par initiales s'affiche tant que l'image n'est pas chargée — ici, aucune image n'est fournie."
      >
        <Canvas>
          <Specimen label="simple">
            <Avatar>
              <AvatarFallback>LR</AvatarFallback>
            </Avatar>
          </Specimen>

          <Specimen label="groupe">
            <AvatarGroup>
              <Avatar>
                <AvatarFallback>LR</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>MD</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>SP</AvatarFallback>
              </Avatar>
              <AvatarGroupCount>+3</AvatarGroupCount>
            </AvatarGroup>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Raccourcis clavier et attente"
        description={
          <>
            <Code>Kbd</Code> documente un raccourci, <Code>Spinner</Code> signale
            un traitement dont la durée est inconnue.
          </>
        }
      >
        <Canvas>
          <Specimen label="Kbd">
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </Specimen>
          <Specimen label="Spinner">
            <Spinner />
          </Specimen>
          <Specimen label="Spinner — grand">
            <Spinner className="size-8 text-primary" />
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Proportions"
        description={
          <>
            <Code>AspectRatio</Code> réserve un ratio stable avant même le
            chargement du média — utile pour une panoramique, très large.
          </>
        }
      >
        <div className="max-w-md">
          <AspectRatio ratio={2 / 1}>
            <div className="flex size-full items-center justify-center rounded-lg border border-dashed bg-muted text-sm text-muted-foreground">
              ratio 2:1 — format d&apos;une panoramique
            </div>
          </AspectRatio>
        </div>
      </Section>

      <Separator />

      <Section
        title="Séparateurs"
        description="Horizontal pour scinder des sections, vertical pour séparer des éléments dans une même ligne."
      >
        <Canvas className="block space-y-4">
          <div className="text-sm text-muted-foreground">Bloc supérieur</div>
          <Separator />
          <div className="text-sm text-muted-foreground">Bloc inférieur</div>
          <div className="flex h-5 items-center gap-3 text-sm">
            <span>Analyse</span>
            <Separator orientation="vertical" />
            <span>Rapport</span>
            <Separator orientation="vertical" />
            <span className="inline-flex items-center gap-1">
              <Copy className="size-3.5" aria-hidden="true" />
              Copier
            </span>
          </div>
        </Canvas>
      </Section>
    </div>
  );
}
