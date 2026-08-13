import {
  Check,
  Copy,
  Download,
  FileText,
  MoreHorizontal,
  Search,
  Settings,
  Trash2,
} from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui";

import { Canvas, Code, Section, Specimen } from "./Section";

export function NavigationPanel() {
  return (
    <div className="space-y-10">
      <Section
        title="Fil d'Ariane"
        description="Situe la page courante dans la hiérarchie. Le dernier segment n'est pas un lien : c'est la page affichée."
      >
        <Canvas>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#navigation">Analyses</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="#navigation">9f1c…a2b4</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Rapport</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Onglets"
        description="Sections d'un même écran, sans changement d'URL. C'est le composant qui structure cette page."
      >
        <Canvas className="block">
          <Tabs defaultValue="detections">
            <TabsList>
              <TabsTrigger value="detections">Détections</TabsTrigger>
              <TabsTrigger value="metadata">Métadonnées</TabsTrigger>
              <TabsTrigger value="report">Rapport</TabsTrigger>
            </TabsList>
            <TabsContent value="detections" className="pt-4 text-sm text-muted-foreground">
              12 détections proposées par le modèle.
            </TabsContent>
            <TabsContent value="metadata" className="pt-4 text-sm text-muted-foreground">
              1024 × 512 pixels · mock-0.0.0
            </TabsContent>
            <TabsContent value="report" className="pt-4 text-sm text-muted-foreground">
              Aucun rapport généré pour cette analyse.
            </TabsContent>
          </Tabs>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Pagination"
        description="Pour une future liste d'historique des analyses, quand le volume dépassera un écran."
      >
        <Canvas className="block">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#navigation" />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#navigation">1</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#navigation" isActive>
                  2
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#navigation">3</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#navigation" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Menus contextuels"
        description={
          <>
            <Code>DropdownMenu</Code> s&apos;ouvre depuis un bouton,{" "}
            <Code>ContextMenu</Code> au clic droit. Les deux partagent la même
            grammaire : libellé, séparateur, raccourci.
          </>
        }
      >
        <Canvas className="items-start gap-6">
          <Specimen label="DropdownMenu">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Actions">
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Analyse</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <FileText aria-hidden="true" />
                  Générer le rapport
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Download aria-hidden="true" />
                  Télécharger l&apos;image
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  <Trash2 aria-hidden="true" />
                  Supprimer
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Specimen>

          <Specimen label="ContextMenu — clic droit">
            <ContextMenu>
              <ContextMenuTrigger className="flex h-24 w-56 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                Clic droit ici
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem>
                  <Copy aria-hidden="true" />
                  Copier l&apos;identifiant
                  <ContextMenuShortcut>⌘C</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem>
                  <Settings aria-hidden="true" />
                  Propriétés
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Barre de menus"
        description={
          <>
            <Code>Menubar</Code> reproduit une barre de menus d&apos;application
            de bureau. Pertinent pour un futur poste de revue dense en actions.
          </>
        }
      >
        <Canvas className="block">
          <Menubar>
            <MenubarMenu>
              <MenubarTrigger>Fichier</MenubarTrigger>
              <MenubarContent>
                <MenubarItem>
                  Importer une panoramique <MenubarShortcut>⌘I</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem>Générer le rapport</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger>Affichage</MenubarTrigger>
              <MenubarContent>
                <MenubarItem>Afficher les dents</MenubarItem>
                <MenubarItem>Afficher les anomalies</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger>Aide</MenubarTrigger>
              <MenubarContent>
                <MenubarItem>Design system</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Palette de commandes"
        description={
          <>
            <Code>Command</Code> — recherche filtrante au clavier. Se monte aussi
            en modale (<Code>CommandDialog</Code>) sur un raccourci global.
          </>
        }
      >
        <Canvas className="block">
          <Command className="max-w-md rounded-lg border">
            <CommandInput placeholder="Rechercher une action…" />
            <CommandList>
              <CommandEmpty>Aucun résultat.</CommandEmpty>
              <CommandGroup heading="Analyse">
                <CommandItem>
                  <Search aria-hidden="true" />
                  Importer une panoramique
                </CommandItem>
                <CommandItem>
                  <FileText aria-hidden="true" />
                  Générer le rapport PDF
                  <CommandShortcut>⌘R</CommandShortcut>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Revue">
                <CommandItem>
                  <Check aria-hidden="true" />
                  Valider toutes les détections
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </Canvas>
      </Section>
    </div>
  );
}
