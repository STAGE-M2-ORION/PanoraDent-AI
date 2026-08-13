import { Info, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui";

import { Canvas, Code, Section, Specimen } from "./Section";

export function OverlaysPanel() {
  return (
    <div className="space-y-10">
      <Section
        title="Boîtes de dialogue"
        description={
          <>
            <Code>Dialog</Code> interrompt la tâche pour une action secondaire.{" "}
            <Code>AlertDialog</Code> est réservé aux décisions destructrices : il
            ne se ferme pas au clic extérieur et impose un choix explicite.
          </>
        }
      >
        <Canvas>
          <Specimen label="Dialog">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Modifier la détection</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Modifier la détection</DialogTitle>
                  <DialogDescription>
                    Corriger la classe ou le numéro FDI proposé par le modèle.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="ds-dialog-fdi">Numéro FDI</Label>
                  <Input id="ds-dialog-fdi" defaultValue="11" />
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Annuler</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button>Enregistrer</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Specimen>

          <Specimen label="AlertDialog">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 aria-hidden="true" />
                  Supprimer l&apos;analyse
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer cette analyse ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    L&apos;image anonymisée, les détections et le rapport PDF
                    seront définitivement supprimés. Cette action est irréversible.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction>Supprimer</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Panneaux latéraux"
        description={
          <>
            <Code>Sheet</Code> glisse depuis un bord — adapté à un panneau de
            réglages. <Code>Drawer</Code> monte depuis le bas et se referme au
            glissé : c&apos;est l&apos;équivalent tactile.
          </>
        }
      >
        <Canvas>
          <Specimen label="Sheet — droite">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Ouvrir les réglages</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Réglages d&apos;affichage</SheetTitle>
                  <SheetDescription>
                    N&apos;affecte que la visualisation, jamais les données
                    persistées.
                  </SheetDescription>
                </SheetHeader>
                <div className="space-y-2 px-4">
                  <Label htmlFor="ds-sheet-threshold">Seuil de confiance</Label>
                  <Input id="ds-sheet-threshold" defaultValue="0.55" />
                </div>
                <SheetFooter>
                  <SheetClose asChild>
                    <Button>Appliquer</Button>
                  </SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </Specimen>

          <Specimen label="Drawer — bas">
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="outline">Ouvrir le tiroir</Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Détails de la détection</DrawerTitle>
                  <DrawerDescription>
                    Dent · FDI 11 · confiance 94 %
                  </DrawerDescription>
                </DrawerHeader>
                <DrawerFooter>
                  <DrawerClose asChild>
                    <Button variant="outline">Fermer</Button>
                  </DrawerClose>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Survol et ancrage"
        description={
          <>
            <Code>Tooltip</Code> pour un mot d&apos;explication,{" "}
            <Code>HoverCard</Code> pour un aperçu riche, <Code>Popover</Code> pour
            un contenu interactif. Aucun des trois ne doit porter une information
            indispensable : ils sont inatteignables au toucher pour les deux
            premiers.
          </>
        }
      >
        <Canvas>
          <Specimen label="Tooltip">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Mode d&apos;inférence</Button>
              </TooltipTrigger>
              <TooltipContent>
                mock = détections factices, sans valeur diagnostique
              </TooltipContent>
            </Tooltip>
          </Specimen>

          <Specimen label="HoverCard">
            <HoverCard>
              <HoverCardTrigger asChild>
                <Button variant="link">mock-0.0.0</Button>
              </HoverCardTrigger>
              <HoverCardContent className="w-72">
                <div className="flex gap-3">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">Modèle de démonstration</p>
                    <p className="text-muted-foreground">
                      Génère des boîtes plausibles à partir des dimensions de
                      l&apos;image. Déterministe pour une taille donnée.
                    </p>
                  </div>
                </div>
              </HoverCardContent>
            </HoverCard>
          </Specimen>

          <Specimen label="Popover">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Filtrer</Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Filtrer les détections</p>
                  <p className="text-sm text-muted-foreground">
                    Contrairement au tooltip, ce contenu est interactif.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ds-popover-min">Confiance minimale</Label>
                  <Input id="ds-popover-min" defaultValue="0.55" />
                </div>
              </PopoverContent>
            </Popover>
          </Specimen>
        </Canvas>
      </Section>
    </div>
  );
}
