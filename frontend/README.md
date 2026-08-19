# Frontend — architecture

Application Next.js 14 (pages router) en **export statique**, organisée selon
**Feature-Sliced Design** (FSD 2.1), habillée par **shadcn/ui** sur
**Tailwind CSS v4**.

> 🎨 Le design system est documenté **par l'application elle-même** :
> [http://localhost:3000/design-system](http://localhost:3000/design-system) —
> 55 composants répartis en huit onglets. La page rend les vrais composants,
> elle ne peut donc pas mentir sur leur apparence.

## Couches

Les imports vont **toujours vers le bas**. Une couche ne peut importer que des
couches strictement inférieures — jamais une couche supérieure, jamais une
autre slice de la même couche.

```
app          providers globaux, styles et jetons de design
  ↓
views        pages composées (couche « pages » de FSD, cf. note ci-dessous)
  ↓
widgets      blocs autonomes composant features + entities
  ↓
features     actions utilisateur porteuses de valeur métier
  ↓
entities     concepts métier : modèle, appels API, UI de présentation
  ↓
shared       socle réutilisable, sans aucune connaissance du métier
```

| Couche | Slices actuelles |
|---|---|
| `app` | `providers/`, `styles/` |
| `views` | `landing`, `analysis`, `design-system` |
| `widgets` | `app-header`, `detection-viewer` |
| `features` | `upload-analysis`, `generate-report` |
| `entities` | `analysis`, `detection`, `system-status` |
| `shared` | `api`, `config`, `lib`, `ui` |

### Pourquoi `views` et pas `pages`

Le dossier `pages/` à la racine est **réservé au routeur Next.js**. La couche
« pages » de FSD est donc nommée `views` — c'est la convention recommandée pour
Next.js. Les fichiers de `pages/` sont de simples adaptateurs :

```jsx
// pages/index.jsx
export { LandingPage as default } from "@/views/landing";
```

Aucune UI, aucun appel API, aucun état n'y vit.

### Routes

| Route | Slice | Rôle |
|---|---|---|
| `/` | `views/landing` | Vitrine : présentation de la plateforme, sans appel API hors bandeau d'état |
| `/analyse` | `views/analysis` | Poste de travail : import, détections, rapport |
| `/design-system` | `views/design-system` | Catalogue des composants |

La racine a longtemps hébergé le poste d'analyse. Elle accueille désormais la
vitrine : un visiteur doit pouvoir comprendre l'outil avant d'y déposer une
image. Le poste de travail vit sur `/analyse`, et le titre de `AppHeader` y
ramène à la vitrine.

## Segments

Chaque slice est découpée par **rôle technique**, pas par type de fichier :

| Segment | Contenu |
|---|---|
| `api/` | appels HTTP et mapping DTO → modèle |
| `model/` | logique métier, hooks d'état, normalisation |
| `lib/` | utilitaires purs propres à la slice |
| `ui/` | composants React |
| `index.js` | **API publique** de la slice |

## Règle d'import

Une slice s'importe **uniquement par son API publique** :

```js
import { createAnalysis } from "@/entities/analysis";        // ✅
import { createAnalysis } from "@/entities/analysis/api/analysis-api"; // ❌
```

L'alias `@/` pointe vers `src/` ([jsconfig.json](jsconfig.json)).

### Imports transverses (`@x`)

Deux entités qui doivent se connaître passent par la notation `@x`, qui rend la
dépendance explicite et limitée :

```js
// entities/analysis/model/analysis.js
import { normalizeDetection } from "@/entities/detection/@x/analysis";
```

`entities/detection/@x/analysis.js` déclare exactement ce que `analysis` a le
droit d'utiliser. Deux cross-imports existent aujourd'hui :

- `entities/detection/@x/analysis.js` → `normalizeDetection`
- `entities/analysis/@x/system-status.js` → `InferenceMode`

---

## Design system

### shadcn/ui dans la couche `shared`

Les composants shadcn ne sont pas une dépendance npm : la CLI **copie leur code
source** dans le dépôt. [components.json](components.json) les dirige vers la
couche FSD plutôt que vers le `components/ui` par défaut :

```json
"aliases": { "ui": "@/shared/ui", "utils": "@/shared/lib/utils" }
```

La couche compte **55 composants** pour ~290 exports, couvrant l'essentiel du
développement web : formulaires, tableaux, cartes, navigation, surcouches,
retours utilisateur, graphiques.

Ajouter un composant :

```bash
npx shadcn@latest add dialog     # → src/shared/ui/dialog.jsx
npm run ui:index                 # régénère l'API publique
```

**`shared/ui/index.js` est généré**, jamais édité à la main :
[`scripts/generate-ui-index.mjs`](scripts/generate-ui-index.mjs) lit les exports
réels de chaque fichier et échoue si deux composants exportent le même nom. Un
composant installé mais oublié dans le baril serait invisible pour le reste de
l'application — le script supprime ce risque.

#### Retouches locales

Ces fichiers **appartiennent au dépôt** et peuvent être modifiés, mais un
`add --overwrite` les réécrase. Toute retouche est donc signalée par un
commentaire dans le fichier concerné :

| Fichier | Retouche | Raison |
|---|---|---|
| `alert.jsx` | variantes `warning` et `success` | shadcn ne fournit que `destructive` |
| `badge.jsx` | variantes `warning` et `success` | idem, pour les statuts d'exécution |
| `skeleton.jsx` | `bg-accent` → `bg-muted` | l'accent est teinté de la marque ; un placeholder doit rester neutre |
| `pagination.jsx` | libellés traduits | l'interface est en français |

`file-picker.jsx` est un composant **maison** (shadcn n'a pas d'équivalent) : il
emprunte `buttonVariants` pour rester visuellement aligné sur `Button`.

#### Coût du baril

`package.json` déclare `"sideEffects": ["*.css"]`. Sans cette ligne, webpack
considère chaque module comme potentiellement à effet de bord et embarque les
55 composants dès qu'une page importe un seul `Button` : le JS partagé passe de
125 à 213 ko. Les feuilles CSS sont exclues de la déclaration — leur import
**est** un effet de bord.

### Jetons

Tout vit dans [`app/styles/globals.css`](src/app/styles/globals.css) — il n'y a
plus de `tokens.css` séparé, c'est la convention shadcn :

- `:root` et `.dark` définissent les variables en **OKLCH**, converties depuis
  la charte historique (teal `#0F766E` / `#134E4A`) sans dérive de teinte ;
- `@theme inline` les expose comme utilitaires Tailwind (`bg-primary`,
  `text-warning`, `bg-detection-anomaly`…) ;
- `--radius` est l'unique source des quatre rayons.

Aux jetons shadcn standards s'ajoutent `warning`, `success`, et les couleurs
métier `detection-normal` / `detection-anomaly`.

> Les couleurs de détection sont **volontairement dupliquées** en hexadécimal
> dans [`entities/detection`](src/entities/detection/model/detection.js) : le
> canvas ne lit pas les variables CSS. Les deux doivent évoluer ensemble.

### Thème sombre

Les jetons `.dark` existent et la page design system permet de les prévisualiser,
mais **l'application reste en clair** : les couleurs de tracé du canvas sont
figées. Le hook `useThemePreview` retire donc la classe `dark` en quittant la
page.

### Styles

Plus aucun CSS Module : toute la mise en forme passe par des classes Tailwind,
et les valeurs viennent des jetons. Pas de style inline, pas de couleur brute
dans une slice.

Une classe Tailwind doit apparaître **littéralement** dans le source — une
classe construite dynamiquement (`` `bg-${name}` ``) ne serait pas générée.
C'est pourquoi le catalogue de la page design system stocke des chaînes de
classes complètes.

## Animations

**GSAP** (`gsap` + `@gsap/react`) n'anime aujourd'hui que la vitrine. Le hook
[`use-landing-reveal.js`](src/views/landing/lib/use-landing-reveal.js) concentre
toute la logique ; les composants ne portent qu'un attribut déclaratif.

| `data-reveal` | Effet |
|---|---|
| `hero` | enfants directs décalés au chargement |
| `frame` | visuel d'en-tête, fondu et léger zoom |
| `box` | boîtes de détection, apparition rebondie |
| `scan` | ligne de balayage, boucle infinie |
| `section` | l'élément monte en fondu au défilement |
| `stagger` | enfants directs décalés au défilement |

Quatre points structurants :

- **`useGSAP` avec un `scope`.** Le hook reçoit la ref du conteneur de page :
  les sélecteurs ne sortent jamais de la vitrine, et toutes les animations
  créées sont révoquées au démontage. Sans `scope`, un `ScrollTrigger` survivrait
  à la navigation vers `/analyse`.
- **Import nommé obligatoire.** `import { gsap } from "gsap"`, jamais
  `import gsap from "gsap"` : au prérendu, webpack résout la build CJS dont
  l'export par défaut est l'espace de noms du module. `gsap.registerPlugin` y
  est introuvable et `next build` échoue sur `Failed to collect page data`.
- **Uniquement des `from`.** L'état final est celui du DOM rendu : sans
  JavaScript, ou si GSAP échoue, la page reste entièrement lisible. La
  contrepartie est un état initial non masqué avant hydratation.
- **`prefers-reduced-motion` respecté.** `gsap.matchMedia()` court-circuite
  l'ensemble ; le DOM statique fait alors déjà le bon rendu.

Les plugins sont enregistrés au niveau module (`registerPlugin(useGSAP,
ScrollTrigger)`) : jamais référencés autrement que par leur effet de bord, ils
seraient sinon candidats à l'élagage.

## Conventions

- **Frontière DTO / modèle.** Le backend parle snake_case (`created_at`,
  `n_detections`, `w`, `h`). Cette forme s'arrête dans le segment `api/` :
  au-dessus, tout est camelCase et normalisé (`model/*.js`).
- **Erreurs normalisées.** `shared/api/app-error.js` convertit toute exception
  axios en `AppError { code, message }`, avec un message français prêt à
  afficher. Aucun composant ne manipule d'erreur axios.
- **État asynchrone.** `shared/lib/use-async-action.js` fournit la machine
  `idle → pending → success | error` utilisée par les features.

## Ajouter une fonctionnalité

Exemple, la revue praticien (route `PATCH` sur les détections) :

1. `entities/detection/api/detection-api.js` — l'appel HTTP et son mapping.
2. `features/review-detection/` — `model/use-review-detection.js` + `ui/`.
3. Brancher la feature dans `widgets/detection-viewer`.
4. Exporter chaque nouveauté par l'`index.js` de sa slice.

La page `views/analysis` n'a rien à savoir de l'implémentation.

## Commandes

```bash
npm install     # npm ci en CI et dans Docker (le lockfile fait foi)
npm run dev     # http://localhost:3000, hot reload
npm run build   # export statique dans out/
```

En `next dev`, il n'y a pas de proxy nginx : pointer l'API vers le backend.

```bash
NEXT_PUBLIC_API_BASE=http://localhost:8000/api npm run dev
# PowerShell : $env:NEXT_PUBLIC_API_BASE="http://localhost:8000/api"; npm run dev
```
