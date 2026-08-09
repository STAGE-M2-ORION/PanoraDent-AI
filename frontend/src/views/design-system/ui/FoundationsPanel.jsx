import { Separator } from "@/shared/ui";

import {
  ALL_COLOR_TOKENS,
  COLOR_GROUPS,
  RADIUS_SCALE,
  SPACING_SCALE,
  TYPOGRAPHY_SCALE,
} from "../lib/design-tokens";
import { useResolvedTokens } from "../lib/use-resolved-tokens";
import { Canvas, Section } from "./Section";

function Swatch({ swatch, value }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div
        className={`flex h-20 items-end p-3 text-xs font-medium ${swatch.className}`}
      >
        {swatch.note}
      </div>
      <div className="space-y-0.5 border-t bg-card p-3">
        <p className="font-mono text-xs font-medium">--{swatch.token}</p>
        <p className="font-mono text-[11px] break-all text-muted-foreground">
          {value || "—"}
        </p>
      </div>
    </div>
  );
}

export function FoundationsPanel({ themeRevision }) {
  // `themeRevision` n'est pas affiché : il force la relecture des variables CSS
  // après une bascule de thème. Il vient de la page, car `document` n'existe
  // pas au prérendu statique.
  const values = useResolvedTokens(ALL_COLOR_TOKENS, themeRevision);

  return (
    <div className="space-y-10">
      <Section
        title="Couleurs"
        description="Chaque jeton est une variable CSS en OKLCH, exposée à Tailwind par @theme inline. Les valeurs affichées sont celles réellement calculées par le navigateur."
      >
        <div className="space-y-8">
          {COLOR_GROUPS.map((group) => (
            <div key={group.title} className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold">{group.title}</h4>
                <p className="text-sm text-muted-foreground">{group.description}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {group.swatches.map((swatch) => (
                  <Swatch
                    key={swatch.token}
                    swatch={swatch}
                    value={values[swatch.token]}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Separator />

      <Section
        title="Typographie"
        description="Une seule famille (system-ui) et une échelle courte. La graisse et la couleur portent la hiérarchie, pas la taille seule."
      >
        <div className="divide-y rounded-lg border bg-card">
          {TYPOGRAPHY_SCALE.map((entry) => (
            <div
              key={entry.label}
              className="flex flex-wrap items-baseline justify-between gap-4 p-4"
            >
              <span className={entry.className}>{entry.sample}</span>
              <code className="font-mono text-[11px] text-muted-foreground">
                {entry.className}
              </code>
            </div>
          ))}
        </div>
      </Section>

      <Separator />

      <Section
        title="Rayons"
        description="Tous dérivés d'un unique --radius (0.625rem) : changer cette valeur reforme l'ensemble de l'interface."
      >
        <Canvas className="gap-6">
          {RADIUS_SCALE.map((radius) => (
            <div key={radius.label} className="flex flex-col items-center gap-2">
              <div
                className={`size-16 border-2 border-primary bg-primary/10 ${radius.className}`}
              />
              <code className="font-mono text-[11px] text-muted-foreground">
                {radius.label} · {radius.formula}
              </code>
            </div>
          ))}
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Espacements"
        description="Échelle Tailwind par pas de 0.25rem. Les blocs de page utilisent 4 et 6, les groupes de contrôles 2 et 3."
      >
        <div className="space-y-2 rounded-lg border bg-card p-6">
          {SPACING_SCALE.map((step) => (
            <div key={step.label} className="flex items-center gap-4">
              <code className="w-8 font-mono text-[11px] text-muted-foreground">
                {step.label}
              </code>
              <div className={`h-3 rounded-full bg-primary ${step.className}`} />
              <code className="font-mono text-[11px] text-muted-foreground">
                {step.value}
              </code>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
