/**
 * Catalogue des jetons exposés par `app/styles/globals.css`.
 *
 * Les classes utilitaires sont écrites **en toutes lettres** : Tailwind scanne
 * le texte source et ne génère que les classes qu'il y trouve littéralement.
 * Une classe construite dynamiquement (`bg-${name}`) ne serait pas produite.
 */

export const COLOR_GROUPS = [
  {
    title: "Surfaces",
    description: "Fonds de page et de conteneurs, avec leur couleur de texte associée.",
    swatches: [
      { token: "background", className: "bg-background text-foreground" },
      { token: "card", className: "bg-card text-card-foreground" },
      { token: "popover", className: "bg-popover text-popover-foreground" },
      { token: "muted", className: "bg-muted text-muted-foreground" },
    ],
  },
  {
    title: "Marque",
    description:
      "Teal historique de PanoraDent (#0F766E / #134E4A), converti en OKLCH sans dérive de teinte.",
    swatches: [
      { token: "primary", className: "bg-primary text-primary-foreground" },
      { token: "secondary", className: "bg-secondary text-secondary-foreground" },
      { token: "accent", className: "bg-accent text-accent-foreground" },
      { token: "ring", className: "bg-ring text-primary-foreground" },
    ],
  },
  {
    title: "Statuts",
    description:
      "warning et success sont des ajouts projet : shadcn ne fournit que destructive.",
    swatches: [
      { token: "destructive", className: "bg-destructive text-destructive-foreground" },
      { token: "warning", className: "bg-warning text-warning-foreground" },
      { token: "success", className: "bg-success text-success-foreground" },
      { token: "border", className: "bg-border text-foreground" },
    ],
  },
  {
    title: "Métier — détections",
    description:
      "Couleurs des boîtes tracées sur la panoramique. Répliquées en hexadécimal dans entities/detection : le canvas ne lit pas les variables CSS.",
    swatches: [
      {
        token: "detection-normal",
        className: "bg-detection-normal text-primary-foreground",
        note: "dent saine",
      },
      {
        token: "detection-anomaly",
        className: "bg-detection-anomaly text-destructive-foreground",
        note: "anomalie",
      },
    ],
  },
];

/** Liste à plat, d'identité stable : sert de dépendance au hook de résolution. */
export const ALL_COLOR_TOKENS = COLOR_GROUPS.flatMap((group) =>
  group.swatches.map((swatch) => swatch.token),
);

export const TYPOGRAPHY_SCALE = [
  { label: "Titre de page", className: "text-3xl font-semibold tracking-tight", sample: "PanoraDent AI" },
  { label: "Titre de section", className: "text-xl font-semibold", sample: "Détections proposées" },
  { label: "Titre de carte", className: "text-base font-semibold", sample: "Rapport d'analyse" },
  { label: "Corps", className: "text-sm", sample: "12 détections · modèle mock-0.0.0" },
  { label: "Secondaire", className: "text-sm text-muted-foreground", sample: "Aide au diagnostic — prototype non certifié." },
  { label: "Mono", className: "font-mono text-xs", sample: "images/9f1c-…-a2b4.png" },
];

export const RADIUS_SCALE = [
  { label: "sm", className: "rounded-sm", formula: "--radius - 4px" },
  { label: "md", className: "rounded-md", formula: "--radius - 2px" },
  { label: "lg", className: "rounded-lg", formula: "--radius" },
  { label: "xl", className: "rounded-xl", formula: "--radius + 4px" },
];

/** Échelle Tailwind par défaut (0.25rem), restreinte aux pas réellement utilisés. */
export const SPACING_SCALE = [
  { label: "1", className: "w-1", value: "0.25rem" },
  { label: "2", className: "w-2", value: "0.5rem" },
  { label: "3", className: "w-3", value: "0.75rem" },
  { label: "4", className: "w-4", value: "1rem" },
  { label: "6", className: "w-6", value: "1.5rem" },
  { label: "8", className: "w-8", value: "2rem" },
  { label: "12", className: "w-12", value: "3rem" },
];
