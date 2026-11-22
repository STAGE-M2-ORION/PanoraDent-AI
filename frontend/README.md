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
| `views` | `racine`, `accueil`, `connexion`, `mentions`, `tableau-de-bord`, `nouvelle-analyse`, `analyse`, `compte-rendu`, `historique`, `profil`, `performance`, `admin-comptes`, `admin-roles`, `admin-audit`, `admin-supervision`, `design-system` |
| `widgets` | `app-shell` (bandeau, barre latérale, barre du haut, garde de session, 403), `analysis-workspace` (modèle de lecture d'une analyse, réelle ou de démonstration) |
| `features` | `request-access`, `generate-report`, `manage-users`, `manage-roles` |
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
| `/` | aucun — aiguillage : connecté → page d'arrivée du rôle, sinon `/connexion` | — |
| `/decouvrir` | `accueil.html` — vitrine | public |
| `/connexion` | `connexion.html` — « Continuer avec Google » et ses états | public |
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

`/login` et `/admin` redirigent vers leurs nouvelles adresses.
La barre latérale n'affiche que les entrées permises par les **permissions
réelles** du rôle (rôles personnalisés compris), pas une liste figée par rôle ;
toute la section Administration exige en plus `user:manage`.

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
vectorielle simulée).

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
| Suppression d'analyse, demande d'accès | appel envoyé ; en 404, l'écran dit que la fonction n'est pas encore disponible |
| Assistant | réponses de démonstration sur `/analyse` sans `id` ; « indisponible » sur une vraie analyse |

Tout ce qui est fictif passe par `shared/demo` : le jour où une route existe,
l'entité concernée appelle l'API et la démonstration recule, sans toucher aux écrans.

## Conventions

- **Frontière DTO / modèle.** Le snake_case du backend s'arrête dans `api/` ;
  au-dessus, tout est camelCase et normalisé (`model/*.js`). La confiance des
  détections est convertie en pourcentage entier.
- **Erreurs normalisées.** `shared/api/app-error.js` convertit toute exception
  axios en `AppError { code, serverCode, message, details }`. Le backend renvoie
  toute erreur sous la forme `{ code, message, details? }` : `message`, en
  français, s'affiche **tel quel** ; `serverCode` garde le code métier
  (`adresse_deja_prise`, `dernier_administrateur`…).
- **Dates.** Le backend renvoie des dates ISO avec fuseau (timestamptz) :
  `new Date(iso)` suffit, aucun `Z` à ajouter.
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
npm install       # npm ci en CI et dans Docker (le lockfile fait foi)
npm run dev       # http://localhost:3000, hot reload
npm run build     # export statique dans out/
npm run test:e2e  # Playwright, contre une stack déjà démarrée (voir plus bas)
```

En `next dev`, il n'y a pas de proxy nginx : pointer l'API vers le backend.

```bash
NEXT_PUBLIC_API_BASE=http://localhost:8000/api/v1 npm run dev
# PowerShell : $env:NEXT_PUBLIC_API_BASE="http://localhost:8000/api/v1"; npm run dev
```

`localhost:3000` et `localhost:8000` sont le même *site* : les cookies de
session passent, à condition que le backend autorise `http://localhost:3000` en
CORS **avec** `allow_credentials` et que son `APP_URL` pointe sur
`http://localhost:3000` (redirection après Google). Le plus simple reste la
stack Docker, où nginx sert l'application et l'API sur la même origine.

### Tests de bout en bout (Playwright)

[`e2e/parcours-connexion.spec.js`](e2e/parcours-connexion.spec.js) joue le
parcours réel contre le **fournisseur d'identité de remplacement** du backend,
actif seulement avec `APP_ENV=test` et `IDENTITY_PROVIDER=fake` :
`/auth/google/demarrer` redirige vers `/api/v1/auth/fake/autoriser`, un
formulaire minimal (adresse e-mail + « Se connecter ») qui renvoie ensuite vers
le retour Google habituel.

1. l'administrateur se connecte, crée un compte praticien, se déconnecte ;
2. le praticien se connecte, arrive sur `/tableau-de-bord`, sans entrée
   d'administration dans la navigation ;
3. les états d'erreur de `/connexion` (`?erreur=compte_inconnu`,
   `?erreur=echec_google`, `?etat=expiree`).

```bash
npx playwright install chromium   # une fois
E2E_BASE_URL=http://localhost:8080 E2E_ADMIN_EMAIL=admin@exemple.test npm run test:e2e
```

| Variable | Défaut | Rôle |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:3000` | adresse de l'application |
| `E2E_ADMIN_EMAIL` | `ADMIN_EMAIL`, sinon `admin@panoradent.test` | compte administrateur amorcé par le backend de test (`seed_auth`) |

## Authentification côté client

**Google uniquement, aucun mot de passe** : pas de mot de passe provisoire, pas
de réinitialisation, pas de « se souvenir de moi ». Seuls les comptes créés par
un administrateur (adresse Google + rôle) peuvent entrer.

### Parcours

1. `/connexion` → « Continuer avec Google » fait une **vraie navigation**
   (`window.location.assign`, jamais un fetch) vers
   `GET /api/v1/auth/google/demarrer`, qui redirige (302) vers Google.
2. Retour de Google sur le backend : en succès, il pose les cookies et
   redirige vers `/` ; en échec, vers `/connexion?erreur=<code>`.
3. `/` demande `GET /moi` et oriente : `user:manage` → `/admin`, sinon
   `/tableau-de-bord`.

### Session : cookies `httpOnly`

- Le backend pose deux cookies `httpOnly` : accès (15 min) et
  rafraîchissement (7 j). **Le JavaScript ne voit, ne stocke ni n'envoie aucun
  jeton** : pas d'en-tête `Authorization`, rien dans `localStorage` ni
  `sessionStorage`.
- **Client HTTP** ([`shared/api/client.js`](src/shared/api/client.js)) :
  `withCredentials: true`, délai maximal, base `/api/v1`. Sur `401`, **un
  seul** `POST /auth/rafraichir` partagé entre les requêtes concurrentes, puis
  une relance unique ; si le rafraîchissement échoue, le gestionnaire « session
  expirée » est appelé. Option par requête `skipRefresh: true`.
- **Session** (`entities/session`) : `SessionProvider` appelle `GET /moi` au
  montage → `authenticated` ou `anonymous`. `useCurrentUser()` →
  `{ status, user, endReason, logout, can, canAny }`, avec
  `user = { email, nom, prenom, fullName, role (libellé), roleId, permissions, … }`.
  `logout()` = `POST /auth/deconnexion` puis état anonyme.
- `homePathFor(user)` et `screenProfile(user)` se déduisent des
  **permissions**, pas du nom du rôle.

### Page de connexion : états

| État | Déclencheur | Affichage |
|---|---|---|
| Repos | — | bouton « Continuer avec Google » + mention « réservé aux comptes créés par l'administrateur » |
| En cours | clic | bouton désactivé, « Redirection vers Google… » |
| `compte_inconnu` | `?erreur=` | encart rouge : demander un compte à l'administrateur |
| `compte_desactive` | `?erreur=` | encart rouge : contacter l'administrateur |
| `adresse_non_verifiee` | `?erreur=` | encart rouge : vérifier l'adresse chez Google |
| `etat_invalide`, `echec_google` (et tout code inconnu) | `?erreur=` | encart neutre + « Réessayer » |
| Session expirée | `?etat=expiree` (garde de route) | bandeau d'information au-dessus du bouton |
| Déconnecté | `?etat=deconnecte` | bandeau de confirmation |
| Déjà connecté | session active | redirection vers la page d'arrivée du rôle |

Les messages entrent dans une région `aria-live` ; le bouton suit les consignes
de marque Google (fond blanc, bordure `#747775`, texte `#1F1F1F`, police Roboto
ou système, « G » officiel en SVG) et garde l'anneau de focus de la carte.

### Garde de route

L'export statique interdit le middleware Next : la garde est **côté client**,
dans `widgets/app-shell`. Toute page qui passe par `AppShell` exige une
session ; `/connexion`, `/mentions`, `/decouvrir`, `/design-system` et les
fichiers statiques ne l'utilisent pas. Sans session → `/connexion` (avec
`etat=expiree` si la session vient d'expirer) ; sans la permission → écran 403.
Ces gardes ne sont qu'ergonomiques : **le backend fait foi**.

### Administration des comptes

Création avec prénom, nom (facultatifs : repris de Google à la première
connexion), **adresse Google** et rôle ; modification du nom et du rôle ;
activation / désactivation. **Pas de suppression** : un compte qui ne doit plus
entrer est désactivé. Les refus du serveur (`adresse_deja_prise`,
`dernier_administrateur`, `champ_invalide`…) s'affichent tels quels.
