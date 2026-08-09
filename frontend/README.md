# Frontend — architecture

Application Next.js 14 (pages router) en **export statique**, organisée selon
**Feature-Sliced Design** (FSD 2.1), habillée par **shadcn/ui** sur
**Tailwind CSS v4**.

> 🎨 Le design system est documenté **par l'application elle-même** :
> [http://localhost:3000/design-system](http://localhost:3000/design-system).
> La page rend les vrais composants — elle ne peut pas mentir sur leur apparence.

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
| `views` | `home`, `design-system` |
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
export { HomePage as default } from "@/views/home";
```

Aucune UI, aucun appel API, aucun état n'y vit.

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

Ajouter un composant :

```bash
npx shadcn@latest add dialog     # → src/shared/ui/dialog.jsx
```

Puis l'exporter depuis [`shared/ui/index.js`](src/shared/ui/index.js) — c'est
l'API publique de la slice, seule porte d'entrée autorisée.

> ⚠️ Ces fichiers **appartiennent au dépôt** et peuvent être modifiés, mais un
> `add --overwrite` les réécrase. Toute retouche locale doit être signalée par
> un commentaire dans le fichier. Deux existent aujourd'hui : les variantes
> `warning` / `success` ajoutées à `alert.jsx` et `badge.jsx`, absentes de
> shadcn qui ne fournit que `destructive`.

`file-picker.jsx` est un composant **maison** (shadcn n'a pas d'équivalent) : il
emprunte `buttonVariants` pour rester visuellement aligné sur `Button`.

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

La page `views/home` n'a rien à savoir de l'implémentation.

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
