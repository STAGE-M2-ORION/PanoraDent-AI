# Frontend — architecture

Application Next.js 14 (pages router) en **export statique**, organisée selon
**Feature-Sliced Design** (FSD 2.1).

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
| `views` | `home` |
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
| `ui/` | composants React et leurs modules CSS |
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

## Conventions

- **Frontière DTO / modèle.** Le backend parle snake_case (`created_at`,
  `n_detections`, `w`, `h`). Cette forme s'arrête dans le segment `api/` :
  au-dessus, tout est camelCase et normalisé (`model/*.js`).
- **Erreurs normalisées.** `shared/api/app-error.js` convertit toute exception
  axios en `AppError { code, message }`, avec un message français prêt à
  afficher. Aucun composant ne manipule d'erreur axios.
- **Styles.** CSS Modules colocalisés avec leur composant. Toutes les valeurs
  (couleurs, espacements, rayons) viennent des jetons de
  [`app/styles/tokens.css`](src/app/styles/tokens.css) — pas de valeur brute
  dans une slice, pas de style inline.
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
npm run dev     # http://localhost:3000, hot reload
npm run build   # export statique dans out/
```

En `next dev`, il n'y a pas de proxy nginx : pointer l'API vers le backend.

```bash
NEXT_PUBLIC_API_BASE=http://localhost:8000/api npm run dev
# PowerShell : $env:NEXT_PUBLIC_API_BASE="http://localhost:8000/api"; npm run dev
```
