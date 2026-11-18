# Frontend — architecture

Application Next.js 14 (pages router) en **export statique**, organisée selon
**Feature-Sliced Design** (FSD 2.1). L'interface reproduit la **maquette haute
fidélité validée** (`docs/maquette/`) : mêmes jetons, mêmes composants, mêmes
écrans. Aucune bibliothèque d'interface : le design system est écrit dans le
dépôt (`src/shared/ui/`), en CSS et en React.

> 🎨 Catalogue vivant : [http://localhost:3000/design-system](http://localhost:3000/design-system)
> — jetons, icônes, composants, graphiques, détections et états communs. La page
> rend les vrais composants : elle ne peut pas mentir sur leur apparence.

## Couches

Les imports vont **toujours vers le bas**. Une couche ne peut importer que des
couches strictement inférieures — jamais une couche supérieure, jamais une
autre slice de la même couche.

```
app          providers globaux, feuille d'entrée des styles
  ↓
views        écrans (couche « pages » de FSD, cf. note ci-dessous)
  ↓
widgets      blocs composés réutilisés par plusieurs écrans
  ↓
features     actions utilisateur porteuses de valeur métier
  ↓
entities     concepts métier : modèle, appels API, UI de présentation
  ↓
shared       socle sans connaissance du métier : API, lib, design system, démo
```

| Couche | Slices |
|---|---|
| `app` | `providers/`, `styles/` |
| `views` | `accueil`, `connexion`, `mentions`, `tableau-de-bord`, `nouvelle-analyse`, `analyse`, `compte-rendu`, `historique`, `profil`, `performance`, `admin-comptes`, `admin-roles`, `admin-audit`, `admin-supervision`, `design-system` |
| `widgets` | `app-shell` (bandeau, barre latérale, barre du haut, garde de session, 403), `analysis-workspace` (modèle de lecture d'une analyse, réelle ou de démonstration) |
| `features` | `sign-in`, `request-access`, `generate-report`, `manage-users`, `manage-roles` |
| `entities` | `analysis`, `detection`, `session`, `user`, `role`, `model-version`, `system-status` |
| `shared` | `api`, `config`, `lib`, `ui` (design system), `demo` (données de démonstration) |

### Pourquoi `views` et pas `pages`

Le dossier `pages/` à la racine est **réservé au routeur Next.js**. Ses fichiers
sont de simples adaptateurs, sans UI ni logique :

```jsx
// pages/historique.jsx
export { HistoriquePage as default } from "@/views/historique";
```

### Routes

| Route | Écran de la maquette | Accès |
|---|---|---|
| `/` | `accueil.html` — vitrine | public |
| `/connexion` | `connexion.html` — connexion, mot de passe oublié | public |
| `/mentions` | `mentions.html` | public |
| `/design-system` | `etats.html` + `icones.html` + catalogue | public |
| `/tableau-de-bord` | `tableau-de-bord.html` (indicateurs selon le profil) | session |
| `/nouvelle-analyse` | `nouvelle-analyse.html` | `analysis:create` |
| `/historique` | `historique.html` | `analysis:read` |
| `/analyse?id=…` | `analyse.html` — poste de lecture (sans `id` : démonstration) | `analysis:read` |
| `/compte-rendu?id=…` | `compte-rendu.html` | `analysis:read` |
| `/profil` | `profil.html` | session |
| `/performance` | `performance.html` | `model:read` |
| `/admin/comptes` | `admin-comptes.html` | `user:manage` |
| `/admin/roles` | `admin-roles.html` | `role:manage` |
| `/admin/audit` | `admin-audit.html` | `user:manage` |
| `/admin/supervision` | `admin-supervision.html` | `user:manage` |

`/login`, `/admin` et `/mot-de-passe` redirigent vers leurs nouvelles adresses.
La barre latérale n'affiche que les entrées permises par les **permissions
réelles** du rôle (rôles personnalisés compris), pas une liste figée par rôle.

## Segments

| Segment | Contenu |
|---|---|
| `api/` | appels HTTP et mapping DTO → modèle |
| `model/` | logique métier, hooks d'état, normalisation |
| `lib/` | utilitaires purs propres à la slice |
| `ui/` | composants React (+ le CSS propre à l'écran pour une vue) |
| `index.js` | **API publique** de la slice |

## Règle d'import

Une slice s'importe **uniquement par son API publique** :

```js
import { fetchAnalyses } from "@/entities/analysis";               // ✅
import { fetchAnalyses } from "@/entities/analysis/api/analysis-api"; // ❌
```

L'alias `@/` pointe vers `src/` ([jsconfig.json](jsconfig.json)). Deux imports
transverses (`@x`) existent : `entities/detection/@x/analysis.js`
(`normalizeDetection`) et `entities/analysis/@x/system-status.js` (`InferenceMode`).

---

## Design system

### Jetons et styles

Les styles de la maquette (`docs/maquette/theme.css`) ont été découpés, **sans
changer une valeur**, en un fichier par famille dans
[`src/shared/ui/styles/`](src/shared/ui/styles/) :

| Fichier | Contenu |
|---|---|
| `tokens.css` | couleurs, typographie, espacements, rayons, ombres, mouvement, z-index, couleurs des graphiques |
| `fonts.css` | Satoshi, JetBrains Mono, Panora Display (auto-hébergées dans `public/fonts/`) |
| `base.css`, `brand.css` | remise à zéro, typographie, logo, motif signature (équerres cyan) |
| `button.css` | variantes, tailles, bouton Google, bouton « lumière » |
| `field.css`, `surface.css`, `modal.css` | champs ; cartes, pastilles, alertes, squelettes, notifications ; modale |
| `table.css`, `detection.css` | tableaux (mode empilé sur mobile), puces ; pastilles d'anomalie |
| `app-shell.css` | bandeau, barre latérale marine, barre du haut, page, pied |
| `dashboard.css`, `chart.css` | KPI à anneau, grille 12 colonnes ; courbe, histogramme, jauge, barres |
| `icon.css`, `photo-stack.css`, `role-card.css`, `session-log.css`, `icon-sheet.css` | icônes duotone et composants spécialisés |
| `theme-dark.css` | surcharges du mode sombre (`<html data-theme="dark">`) |

[`app/styles/index.css`](src/app/styles/index.css) les importe **dans l'ordre de
la cascade d'origine**, puis [`views.css`](src/app/styles/views.css) importe le
CSS propre à chaque écran.

### Styles propres à un écran

Chaque écran de la maquette avait son bloc `<style>` avec des noms génériques
(`.foot`, `.chip`, `.toast`…). Pour qu'ils ne débordent jamais d'un écran à
l'autre, chacun vit dans `views/<écran>/ui/<écran>.css`, **imbriqué** sous la
classe racine de la vue (CSS imbriqué natif) :

```css
.v-historique {
  .chip { … }          /* ne s'applique que dans l'historique */
}
```

La vue pose cette classe sur sa racine (`<AppShell className="v-historique">`).
Les `@keyframes` et `@page` restent au premier niveau du fichier.

### Composants React (`src/shared/ui/`)

| Module | Exports |
|---|---|
| `icon.jsx` / `icons.js` | `Icon`, `ICON_NAMES` — 62 icônes de la maquette (duotone + interface) |
| `button.jsx` | `Button` (`primary` · `secondary` · `ghost` · `danger` · `google`, `size="sm"`, `href`) — effet « lumière » intégré |
| `brand.jsx` | `Logo`, `GoogleMark` |
| `feedback.jsx` | `Badge`, `Alert`, `Card`, `Skeleton`, `Avatar`, `Modal`, `ToastProvider` / `useToast` |
| `field.jsx` | `Field`, `Input`, `Select`, `Textarea` |
| `table.jsx` | `IdChip`, `NumChip`, `WhoChip`, `Person`, `DateCell`, `IconAction`, `Pager`, `paginate` |
| `chart.jsx` | `KpiRing`, `LineChart`, `BarChart`, `Gauge`, `ProgressList`, `VizEmpty`, `DataDetails`, `exportCsv`, `lastMonths` |
| `photo-stack.jsx` | `PhotoStack` (pile de photos en éventail) |

Les composants produisent **exactement le balisage et les classes de la
maquette** : un écran porté reste identique au pixel près à son modèle.
Les composants métier vivent dans leur entité : `entities/detection` fournit
`DetSwatch`, `TypeChip`, `DetectionBox` et `SimulatedPanoImage` (radiographie
vectorielle simulée), `entities/session` fournit `PasswordInput` et `PasswordStrength`.

### Thème sombre

`useAppTheme()` (`shared/lib/theme.js`) pose `data-theme="dark"` sur `<html>` et
mémorise le choix. Il ne s'applique qu'à l'application connectée : la vitrine et
la connexion restent en clair.

---

## Données réelles et données de démonstration

Les écrans utilisent **l'API réelle** partout où elle existe : session, comptes,
rôles et permissions, analyses (création, liste, détail, image), génération du
PDF, versions du modèle, état des services.

Le backend n'expose pas encore certaines fonctions de la maquette. Leurs écrans
restent identiques, mais :

| Fonction | Comportement actuel |
|---|---|
| Journal d'audit, incidents, disponibilité | données de démonstration ([`shared/demo`](src/shared/demo/)), bandeau ou mention « données fictives » |
| Indicateurs non mesurés (temps de relecture, connexions…) | données de démonstration, mention « données fictives » sur la carte |
| Notifications de la cloche | données de démonstration |
| Relecture des détections (valider, corriger, ajouter, supprimer), clôture | **locale à la session** : aucune route `PATCH` côté serveur (signalé à l'écran) |
| Suppression d'analyse, mot de passe oublié, demande d'accès, Google | appel envoyé ; en 404, l'écran dit que la fonction n'est pas encore disponible |
| Assistant | réponses de démonstration sur `/analyse` sans `id` ; « indisponible » sur une vraie analyse |

Tout ce qui est fictif passe par `shared/demo` : le jour où une route existe,
l'entité concernée appelle l'API et la démonstration recule, sans toucher aux écrans.

## Conventions

- **Frontière DTO / modèle.** Le snake_case du backend s'arrête dans `api/` ;
  au-dessus, tout est camelCase et normalisé (`model/*.js`). La confiance des
  détections est convertie en pourcentage entier.
- **Erreurs normalisées.** `shared/api/app-error.js` convertit toute exception
  axios en `AppError { code, message }` (message français prêt à afficher).
- **État asynchrone.** `useAsyncAction` (actions) et `useAsyncResource`
  (chargements) dans `shared/lib`.
- **Honnêteté de l'interface.** Aucun écran ne prétend avoir fait ce que le
  serveur n'a pas fait.

## Ajouter une fonctionnalité

Exemple, enregistrer la relecture des détections le jour où la route existera :

1. `entities/detection/api/detection-api.js` — l'appel `PATCH` et son mapping.
2. `features/review-detection/` — `model/use-review-detection.js`.
3. Remplacer, dans `views/analyse/ui/AnalysePage.jsx`, les mises à jour locales
   (`updateDet`) par la feature.
4. Exporter chaque nouveauté par l'`index.js` de sa slice.

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

## Authentification côté client

- **Jetons** ([`shared/api/auth-tokens.js`](src/shared/api/auth-tokens.js)) : jeton
  d'accès **en mémoire**, jeton de rafraîchissement en `sessionStorage`, ou en
  `localStorage` si « Se souvenir de moi » est coché à la connexion.
- **Client HTTP** ([`shared/api/client.js`](src/shared/api/client.js)) : ajoute
  `Authorization: Bearer …` ; sur `401`, **un seul** `POST /auth/refresh` partagé
  entre les requêtes concurrentes, puis rejeu ; en cas d'échec, session vidée.
- **Session** (`entities/session`) : `SessionProvider`, `useCurrentUser()` →
  `{ status, user, endReason, login, logout, can, canAny }`. La garde de route est
  dans `widgets/app-shell` : sans session, redirection vers `/connexion?next=…`
  (avec `etat=expiree` ou `etat=deconnecte`) ; sans la permission, écran 403.
  Les gardes ne sont qu'ergonomiques : **le backend fait foi**.
