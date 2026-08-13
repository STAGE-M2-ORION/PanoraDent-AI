import { ArrowLeft, Moon, Sun } from "lucide-react";
import Link from "next/link";

import { Badge, Button, Separator, Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui";

import { useThemePreview } from "../lib/use-theme-preview";
import { BasePanel } from "./BasePanel";
import { DataPanel } from "./DataPanel";
import { DomainPanel } from "./DomainPanel";
import { FeedbackPanel } from "./FeedbackPanel";
import { FormsPanel } from "./FormsPanel";
import { FoundationsPanel } from "./FoundationsPanel";
import { NavigationPanel } from "./NavigationPanel";
import { OverlaysPanel } from "./OverlaysPanel";

/**
 * Référentiel visuel du projet : jetons, composants et conventions métier.
 *
 * Page de documentation vivante — elle rend les vrais composants de
 * `shared/ui` et `entities/*`, jamais des copies. Si un composant change, cette
 * page change avec lui. Elle n'appelle aucune API : toutes les données
 * affichées sont fictives.
 */
export function DesignSystemPage() {
  const { isDark, toggle } = useThemePreview();

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-8">
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-4">
          <Link href="/">
            <ArrowLeft aria-hidden="true" />
            Retour à l&apos;analyse
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Design system</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Socle shadcn/ui (style new-york) sur Tailwind v4, aux couleurs de
              PanoraDent. Les composants sont installés dans{" "}
              <code className="font-mono text-xs">shared/ui</code> et appartiennent
              au dépôt : ils se modifient comme n&apos;importe quel fichier.
            </p>
          </div>

          <Button variant="outline" size="sm" onClick={toggle}>
            {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            Thème {isDark ? "clair" : "sombre"}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline">Tailwind v4</Badge>
          <Badge variant="outline">shadcn/ui — new-york</Badge>
          <Badge variant="outline">Feature-Sliced Design</Badge>
          <Badge variant="secondary">55 composants</Badge>
          <Badge variant="warning">aperçu sombre non appliqué à l&apos;app</Badge>
        </div>
      </header>

      <Separator className="mb-8" />

      <Tabs defaultValue="foundations">
        {/* La barre défile horizontalement plutôt que de se replier sur mobile. */}
        <div className="-mx-6 overflow-x-auto px-6">
          <TabsList className="w-max">
            <TabsTrigger value="foundations">Fondations</TabsTrigger>
            <TabsTrigger value="base">Base</TabsTrigger>
            <TabsTrigger value="forms">Formulaires</TabsTrigger>
            <TabsTrigger value="data">Données</TabsTrigger>
            <TabsTrigger value="navigation">Navigation</TabsTrigger>
            <TabsTrigger value="overlays">Surcouches</TabsTrigger>
            <TabsTrigger value="feedback">Retours</TabsTrigger>
            <TabsTrigger value="domain">Métier</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="foundations" className="pt-8">
          <FoundationsPanel themeRevision={isDark} />
        </TabsContent>
        <TabsContent value="base" className="pt-8">
          <BasePanel />
        </TabsContent>
        <TabsContent value="forms" className="pt-8">
          <FormsPanel />
        </TabsContent>
        <TabsContent value="data" className="pt-8">
          <DataPanel />
        </TabsContent>
        <TabsContent value="navigation" className="pt-8">
          <NavigationPanel />
        </TabsContent>
        <TabsContent value="overlays" className="pt-8">
          <OverlaysPanel />
        </TabsContent>
        <TabsContent value="feedback" className="pt-8">
          <FeedbackPanel />
        </TabsContent>
        <TabsContent value="domain" className="pt-8">
          <DomainPanel />
        </TabsContent>
      </Tabs>
    </main>
  );
}
