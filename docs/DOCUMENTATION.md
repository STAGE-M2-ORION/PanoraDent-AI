# PanoraDent AI — Documentation de la plateforme

Aide au diagnostic par analyse IA des radiographies panoramiques dentaires.

> ⚠️ **Prototype de recherche — NON certifié dispositif médical.**
> Les sorties du système sont des **propositions**. La décision médicale relève
> exclusivement du chirurgien-dentiste. Ne pas utiliser en contexte clinique
> réel ni sur des données patient réelles.

---

## Préambule

### Ce que couvre ce document

Ce document est la **documentation de référence unique** de la plateforme. Il
croise deux sources :

| Source | Apporte |
|---|---|
| **PRD v1.0** — *Édition mémoire, périmètre recentré*, 30/07/2026, RAKOTOMALALA Tolotriniaina Lionel | le **quoi** et le **pourquoi** : périmètre, parcours, exigences, stratégie de données, méthodologie de validation, cadre réglementaire |
| **Code du dépôt** — branche `main`, état du 27/08/2026 | le **comment** et surtout le **jusqu'où** : ce qui est réellement construit, testé, exécutable |

Chaque exigence du PRD est donc présentée **avec son état d'implémentation**.
C'est le cœur de valeur de ce document : il ne décrit pas un produit rêvé, il
décrit un produit **mesuré contre sa spécification**.

### Convention d'état

| Symbole | Signification |
|---|---|
| ✅ | **Implémenté et exécutable** dans la stack actuelle |
| ⚠️ | **Partiel** — présent mais incomplet, dégradé, ou conditionné à une réserve |
| ❌ | **Non implémenté** — spécifié au PRD, absent du code |
| 🔬 | **Hors code** — travail scientifique (données, entraînement, validation) non porté par ce dépôt |

### Les trois autres documents du dépôt

Ce document est le point d'entrée. Il ne remplace pas :

- **[README.md](../README.md)** — mode d'emploi opérationnel de la stack :
  démarrage, ports, variables, dépannage, commandes.
- **[docs/architecture.md](architecture.md)** — vue condensée de l'architecture,
  une page.
- **[frontend/README.md](../frontend/README.md)** — Feature-Sliced Design,
  design system, animations, conventions du client.

### Comment lire

Les sections **1 à 6** décrivent le produit (issues du PRD, annotées de leur
état). Les sections **7 à 9** décrivent le système tel qu'il est construit. La
section **10** traite du cœur scientifique — données, modèle,
validation. Le **pipeline** y est désormais construit ([`training/`](../training/)) ;
les **données** et les **mesures** restent à produire. Les sections **11 à 17** couvrent conformité, exploitation,
risques et pilotage. La section **18** est la matrice de traçabilité complète
PRD → code, et sert de tableau de bord d'avancement.

---

## Le principe directeur

Établi au cadrage du PRD, il justifie chaque arbitrage technique du projet :

> Ce projet n'est pas un défi de **puissance** ni d'**architecture de modèle**.
> C'est un défi de **données**, de **validation clinique** et d'**honnêteté du
> périmètre**. Le choix entre YOLO, Detectron2 ou un Vision Transformer n'est
> jamais le facteur limitant. Ce qui est difficile, c'est de disposer de
> panoramiques annotées par des experts, de **prouver** que le modèle détecte
> réellement ce qu'il prétend détecter, et de présenter le résultat pour ce
> qu'il est — un prototype de recherche, pas un dispositif médical certifié.

**Sa règle d'arbitrage** : à chaque décision, se demander *« est-ce que cela
renforce la preuve que mon IA fonctionne ? »*. Si non, reporter.

Le code respecte visiblement cette règle : l'application est volontairement
minimale (trois routes, deux features), le service d'inférence est isolé et
substituable, et le **mode mock** existe précisément pour que la chaîne
complète soit démontrable **avant** tout entraînement.

---

## 1. Description de la solution

PanoraDent AI analyse automatiquement une radiographie panoramique dentaire pour
assister le chirurgien-dentiste. Elle prend en entrée une panoramique (DICOM ou
image), détecte et numérote les dents selon le système **FDI**, signale un
ensemble d'anomalies ciblées, et produit un **rapport PDF annoté exportable**.

Le cœur de valeur n'est pas l'interface mais **le modèle de détection et sa
validation**. L'application web est la vitrine qui rend ce modèle utilisable et
démontrable ; le pipeline scientifique — données, entraînement, évaluation
chiffrée — est ce qui fait la solidité du projet.

### 1.1 État réel du produit

| | |
|---|---|
| **Chaîne applicative** | ✅ Fonctionnelle de bout en bout : import → anonymisation → stockage → inférence → persistance → rapport PDF |
| **Modèle de détection** | ❌ Aucun modèle entraîné. Le service tourne en **mode mock** et renvoie des détections **factices**. En revanche le pipeline d'entraînement existe ([`training/`](../training/)) et attend les données |
| **Numérotation FDI** | ✅ Hybride depuis le sprint 7 : le modèle apprend le rang (1 à 8), la géométrie donne le quadrant ([`fdi.py`](../inference/app/fdi.py)) ; incohérences signalées, jamais corrigées d'office ; schéma dentaire cliquable (§10.7) |
| **Validation scientifique** | 🔬 Non démarrée — **aucun dataset obtenu**. Le protocole est outillé (découpage par patient, test gelé, métriques par classe), il n'a jamais été exécuté |
| **Revue praticien** | ❌ Schéma de base prêt (`reviewed`, `source`), ni route ni interface |

Autrement dit : **l'infrastructure est en avance sur la science.** Le squelette
attend son modèle. C'est un choix assumé — il permet de valider tout le pipeline
dès le premier jour et de ne pas découvrir les problèmes d'intégration en
semaine 11.

### 1.2 Objectifs (PRD §1) et état

| Objectif | État | Commentaire |
|---|---|---|
| Démontrer une détection **fiable et mesurée** (mAP, sensibilité, spécificité sur un test indépendant) | 🔬 | Aucune métrique produite : aucun dataset obtenu. [`evaluate.py`](../training/evaluate.py) calcule ces chiffres et [`publish_model.py`](../training/publish_model.py) les écrit dans `model_versions` — reste à les exécuter |
| **Réduire le temps et la variabilité** d'interprétation | ⚠️ | La pré-lecture s'affiche, mais elle est factice tant qu'aucun modèle n'est branché |
| Livrer un **produit de bout en bout** | ✅ | Import → inférence → affichage → PDF opérationnel |
| Assurer **traçabilité et confidentialité** | ⚠️ | Anonymisation ✅, aucune donnée identifiante en base ✅, `model_version` tracée par analyse ✅ — journalisation d'audit ❌, chiffrement au repos non activé ❌ |
| Poser un **socle réutilisable** | ✅ | Service d'inférence isolé derrière un contrat HTTP stable, architecture frontend en couches, migrations versionnées |

### 1.3 Périmètre de détection

Resserré autour de ce que les données publiques permettent de démontrer
honnêtement. Les cinq classes sont déclarées dans
[`inference/app/config.py`](../inference/app/config.py) **dans cet ordre**, qui
fait foi pour le mapping des indices YOLO, et que
[`training/config.py`](../training/config.py) **lit directement** — il n'existe
qu'une source de vérité, et `train.py` refuse de démarrer si le dataset en dévie :

| # | Classe (code) | Libellé praticien | Rôle |
|---|---|---|---|
| 0 | `tooth` | Dent | Socle : détection + numérotation FDI |
| 1 | `caries` | Carie | Anomalie |
| 2 | `deep_caries` | Carie profonde | Anomalie |
| 3 | `periapical_lesion` | Lésion périapicale | Anomalie |
| 4 | `impacted_tooth` | Dent incluse | Anomalie |

La traduction française vit **uniquement côté frontend**
([`entities/detection`](../frontend/src/entities/detection/model/detection.js)) :
le PDF affiche les libellés bruts en anglais.

**Kystes et fractures sont hors périmètre** : aucun dataset panoramique annoté
fiable ne les couvre. Les inclure reviendrait à promettre une détection ni
entraînable ni validable (PRD §3, §8.1).

---

## 2. Parties prenantes et utilisateurs

| Entité | Rôle / besoin | Ce que le produit lui offre aujourd'hui |
|---|---|---|
| **Chirurgien-dentiste** (utilisateur cible) | Consulte les détections, les valide ou les corrige, décide du diagnostic. Reste responsable de l'acte médical | Import et visualisation des détections ✅ · Correction ❌ |
| **Porteur du projet / étudiant** | Conçoit, entraîne, valide le modèle, construit l'application, rédige le mémoire | Toute la plateforme, plus le mode mock pour itérer sans GPU |
| **Encadrant / jury** | Évalue la rigueur scientifique, la méthodologie de validation, la qualité du livrable | Page de performance du modèle ❌ — à construire (PRD §5.5) |
| **Radiologue / expert annotateur** | Source de la vérité-terrain ; référence de comparaison | Aucune interface d'annotation (hors périmètre) |
| **Patient** | Objet de l'examen ; ses données doivent être anonymisées et protégées | Anonymisation à l'import ✅, avec la réserve des annotations incrustées dans les pixels ⚠️ |
| **Fournisseurs de données publiques** | DENTEX, Tufts, UFBA-425 — sources des panoramiques annotées | Voir §10.1 (licences et séquence d'accès) |

### Qui décide ? Le praticien, toujours

PanoraDent AI est un outil d'**aide** au diagnostic, jamais un diagnostic
automatique. Ce positionnement n'est pas cosmétique : il conditionne le cadre
réglementaire (§11), la formulation des rapports et la responsabilité juridique.

**Règle de formulation** : toute affirmation (« le patient a une carie ») est
proscrite au profit d'un **signalement** (« zone suspecte de carie, dent 36,
confiance 0,87 »).

Le code applique cette règle :

- l'en-tête affiche en permanence *« Aide au diagnostic — prototype de recherche
  non certifié »* ([`AppHeader.jsx`](../frontend/src/widgets/app-header/ui/AppHeader.jsx)) ;
- la carte des résultats est intitulée **« Détections proposées »**, pas
  « Diagnostic » ([`DetectionViewer.jsx`](../frontend/src/widgets/detection-viewer/ui/DetectionViewer.jsx)) ;
- chaque PDF porte en pied la mention légale
  ([`report.py`](../backend/app/services/report.py)) ;
- en mode mock, un bandeau avertit explicitement : *« détections factices —
  aucun modèle entraîné »* ([`SystemStatusLine.jsx`](../frontend/src/entities/system-status/ui/SystemStatusLine.jsx)).

---

## 3. Périmètre du projet

### 3.1 Dans le périmètre — et son état

| Élément du périmètre (PRD §3) | État | Où |
|---|---|---|
| Import DICOM / JPG / PNG avec anonymisation des métadonnées | ✅ | [`anonymize.py`](../backend/app/services/anonymize.py) |
| Détection et **numérotation FDI** des dents | ⚠️ | Détection : modèle requis. Numérotation ✅ déduite de la géométrie par [`fdi.py`](../inference/app/fdi.py) |
| Détection des 4 anomalies DENTEX | ⚠️ | Classes déclarées ; aucune détection réelle sans modèle |
| Affichage des détections superposées (boîtes, libellés, confiance) | ✅ | Canvas HTML5, [`draw-detections.js`](../frontend/src/widgets/detection-viewer/lib/draw-detections.js) |
| **Correction / validation manuelle** par le praticien | ❌ | Colonnes en base, aucune route ni UI |
| Génération d'un rapport PDF annoté et anonymisé | ✅ | [`report.py`](../backend/app/services/report.py) |
| Tableau de bord : historique, statut, métriques du modèle | ⚠️ | Statut ✅ · historique : API ✅ / UI ❌ · métriques ❌ |
| Pipeline scientifique documenté | ⚠️ | Pipeline **présent** ([`training/`](../training/), [README](../training/README.md)) et documenté ; jamais exécuté faute de données — voir §10 |

### 3.2 Hors périmètre (édition mémoire)

Ces exclusions sont **délibérées** et documentées, pas des oublis :

| Exclu | Raison (PRD) |
|---|---|
| **Kystes et fractures** | Aucune donnée panoramique annotée fiable — reporté en perspectives |
| **n8n, OpenAI, Supabase, Drive, Gmail** | Consommateurs de semaines sans valeur pour la démonstration scientifique. Éventuel bonus de fin de parcours |
| **Autres modalités** (photos intra-orales, CBCT 3D, rétro-alvéolaires) | Autre problème d'apprentissage, autres données |
| **Certification dispositif médical** (CE / FDA) | Hors de portée d'un mémoire ; le produit reste un prototype de recherche |
| **Multi-utilisateurs, gestion de cabinet, facturation** | Non nécessaires à la preuve de concept |

Le code est cohérent avec ces exclusions : aucune trace de n8n, d'intégration
tierce, ni de gestion multi-comptes.

> **Pourquoi ce recentrage.** Détecter « six pathologies » suppose six problèmes
> d'apprentissage, chacun exigeant des annotations expertes. Les données
> publiques en couvrent quatre (via DENTEX) et **aucune** pour les kystes et
> fractures sur panoramique. Étendre le périmètre au-delà des données
> disponibles ne produit pas des détections faibles : il produit des détections
> **impossibles à entraîner et à valider**. Un mémoire réussi démontre peu de
> choses, mais les démontre.

---

## 4. Parcours utilisateurs

### Parcours 1 — L'analyse d'une panoramique (chemin critique)

| # | Étape utilisateur | Ce que fait le système | État |
|---|---|---|---|
| 1 | Importe une panoramique depuis `/analyse` | `POST /api/analyses` en `multipart/form-data` | ✅ |
| 2 | — | Anonymise (tags DICOM ou EXIF), convertit en niveaux de gris, ré-encode en PNG | ✅ |
| 3 | — | Stocke le PNG dans le stockage objet, puis appelle le service d'inférence isolé | ✅ |
| 4 | Voit les détections superposées à l'image, avec libellé et confiance | Rendu canvas à la taille native de l'image | ⚠️ image non affichable en configuration par défaut (voir §14) |
| 5 | Examine, **valide, corrige ou supprime** chaque détection | — | ❌ non implémenté |
| 6 | Génère un rapport PDF annoté, anonymisé | `POST /api/analyses/{id}/report` → PDF A4 stocké, URL présignée 1 h | ✅ |

**Conséquence directe de l'étape 5 manquante** : le PDF produit est un document
**non validé** — il reflète la sortie brute du modèle, pas un arbitrage
praticien. C'est la limite fonctionnelle la plus structurante du prototype.

### Parcours 2 — La consultation de l'historique (sprint 8)

| # | Étape | État |
|---|---|---|
| 1 | Le praticien retrouve une analyse : recherche par référence ou n°, filtres par état, praticien, période et type d'anomalie retenue, tri | ✅ `GET /historique`, filtré et paginé **par le serveur** (pagination par clé, index sur la date, l'état et le déposant) |
| 2 | Il consulte la fiche d'historique de l'analyse : import, traitement, verdicts, clôture, comptes rendus produits | ✅ `GET /analyses/{id}/historique`, lue dans le **journal** et la table des verdicts (jamais modifiés) |
| 3 | Il exporte la liste filtrée pour un suivi d'activité | ✅ `GET /historique.csv` (séparateur « ; », UTF-8), journalisé |
| 4 | Il rouvre l'analyse et son compte rendu | ✅ écran d'analyse ; compte rendu reconstruit à la demande (§5.4) |

### Parcours 3 — L'inspection du modèle (porteur / jury)

| # | Étape | État |
|---|---|---|
| 1 | Consulte la page de performance : métriques par classe, matrice de confusion, galerie d'échecs | ❌ page inexistante |
| 2 | Télécharge le rapport d'évaluation et le protocole de validation | ❌ |

`GET /api/model/versions` est en place et renverra ces métriques. La table
`model_versions` n'est alimentée que par
[`training/publish_model.py`](../training/publish_model.py), qui attend un modèle
entraîné : la route répond `[]` aujourd'hui. La **page** de restitution, elle,
reste entièrement à écrire.

**C'est le parcours le plus important pour le jury, et le moins avancé.** Voir
§10.3 pour la méthodologie qui doit l'alimenter.

---

## 5. Exigences fonctionnelles

### 5.1 Import et anonymisation

| Exigence PRD | État | Implémentation |
|---|---|---|
| Accepter DICOM (`.dcm`) et images (JPG/PNG) | ✅ | Format détecté par l'extension **ou** la signature `DICM` à l'offset 128 — un `.dcm` renommé est reconnu |
| **Anonymiser à l'import**, avant tout stockage | ✅ | 13 tags identifiants écrasés, puis seul le `pixel_array` est conservé. Les images non-DICOM perdent leur EXIF par ré-encodage PNG |
| Conserver la donnée brute anonymisée, jamais modifiée | ⚠️ | Le PNG anonymisé est conservé et l'original **jamais écrit sur disque** — mais aucune route ne permet de *rejouer* une inférence sur une analyse existante |
| **Normaliser** : niveaux de gris, redimensionnement cohérent avec l'entraînement | ⚠️ | Niveaux de gris ✅. `MODEL_IMAGE_SIZE` (défaut 640) fixe désormais le redimensionnement letterbox en mode réel et **doit valoir le `--imgsz` de l'entraînement** ; ultralytics remet les boîtes à l'échelle source. Aucun garde-fou ne vérifie cette égalité : une divergence dégrade les détections en silence |

**Tags DICOM neutralisés** (liste dans
[`anonymize.py`](../backend/app/services/anonymize.py)) :
`PatientName`, `PatientID`, `PatientBirthDate`, `PatientAddress`,
`PatientTelephoneNumbers`, `OtherPatientIDs`, `OtherPatientNames`,
`ReferringPhysicianName`, `InstitutionName`, `InstitutionAddress`, `StudyDate`,
`AccessionNumber`, `StudyID`.

> ⚠️ **Réserve majeure.** Les identifiants **incrustés dans les pixels** (nom du
> patient ou de l'établissement gravé sur le cliché par certains appareils) ne
> sont **pas** retirés. Ils survivent au pipeline et se retrouvent dans le
> stockage **et dans le PDF**. Un masquage de zone est indispensable avant tout
> usage sur données réelles. Ceci répond partiellement à la décision ouverte
> PRD §14.6.

### 5.2 Détection et numérotation

| Exigence PRD | État | Implémentation |
|---|---|---|
| **Numérotation FDI** (quadrant + position) | ✅ | **Hybride** (sprint 7, §10.7) : rang appris par le modèle (`dent_1` … `dent_8`), quadrant donné par la géométrie ([`fdi.py`](../inference/app/fdi.py)) — médiane au centre des incisives, plan d'occlusion par 2-moyennes. Repli sur la position depuis la médiane pour un modèle sans rangs |
| Détection des 4 anomalies | ⚠️ | Classes déclarées et transportées ; nécessite un modèle entraîné |
| **Score de confiance affiché** | ✅ | Affiché en pourcentage dans le canvas, en décimal dans le PDF |
| **Seuil de décision paramétrable** | ⚠️ | `MODEL_CONF_THRESHOLD` (défaut 0,25) filtre en mode réel, côté service. **Aucun réglage côté UI**, et le mock ignore ce seuil |
| Rattachement dent ↔ anomalie (« carie sur la 36 ») | ✅ | L'anomalie est reliée à la dent qui couvre au moins 20 % de son aire (boîte prolongée de 25 % vers l'apex pour une lésion péri-apicale) ; le lien est stocké (`dent_id`) et l'anomalie suit le numéro corrigé de sa dent. Sans recouvrement, `fdi` reste `null` plutôt qu'inventé |

### 5.3 Revue et correction — ❌ non implémenté

| Exigence PRD | État |
|---|---|
| Le praticien peut valider, modifier, ajouter ou supprimer une détection | ❌ |
| Les corrections sont enregistrées pour une future ré-annotation | ⚠️ le **schéma** est prêt : `detections.reviewed` (booléen, défaut `false`) et `detections.source` (`model` \| `human`) |
| Aucune conclusion affirmative produite automatiquement | ✅ respecté partout (voir §2) |

**Ce qu'il manque exactement** : des routes `PATCH /api/analyses/{id}/detections/{did}`,
`POST .../detections`, `DELETE .../detections/{did}`, et une couche d'édition
dans le viewer. Le frontend est prêt à les accueillir : la marche à suivre est
décrite dans [frontend/README.md](../frontend/README.md).

### 5.4 Compte rendu (sprint 8)

| Exigence | État | Détail |
|---|---|---|
| PDF d'une analyse clôturée : image annotée, schéma dentaire, tableau des anomalies retenues | ✅ | [`compte_rendu.py`](../backend/app/services/compte_rendu.py) : image composée **par le serveur** depuis l'image anonymisée ; odontogramme FDI ; anomalies validées, corrigées ou ajoutées |
| En-tête du cabinet : nom, logo, praticien, date de l'examen, référence anonyme | ✅ | Paramètres du cabinet dans l'administration (`cabinet:manage`, migration 0013) ; identité professionnelle du praticien qui a clôturé |
| Mention « prototype non certifié » sur **chaque** page | ✅ | Pied de page avec les mentions du cabinet, la référence et la pagination |
| Version du modèle, seuils, date de clôture | ✅ | Heures dans le fuseau du cabinet (`FUSEAU_HORAIRE`) |
| Options : image, commentaires, propositions rejetées | ✅ | Rejetées seulement sur demande, dans une section séparée et intitulée |
| Conclusion reprise telle que saisie | ✅ | Retours à la ligne conservés |
| Aperçu, régénération à l'identique | ✅ | Reconstruit à chaque demande, **jamais stocké** ; PDF « invariant » : deux générations ne diffèrent que par la date (test) |
| Refus avant la clôture | ✅ | Aperçu « BROUILLON » possible pendant la relecture, non téléchargeable |
| Aucune donnée identifiante | ✅ | Référence anonyme et image anonymisée seulement (test : le nom du fichier importé n'apparaît pas) |
| Aperçus et téléchargements journalisés | ✅ | Auteur, date, référence et options |

Accents et noms français sont gérés (polices standard en Windows-1252,
caractères hors police remplacés plutôt qu'affichés en carré noir). L'ancienne
génération stockée (`POST /report`) est retirée.

### 5.5 Page de performance du modèle — ❌ non implémentée

| Exigence PRD | État |
|---|---|
| Métriques par classe (mAP@0.5, mAP@0.5:0.95, précision, rappel) | ❌ |
| Matrice de confusion, courbes PR, galerie d'exemples | ❌ |
| Version du modèle et du jeu de données utilisés | ⚠️ `model_version` et `inference_mode` sont stockés **par analyse** ✅ ; la table `model_versions` (version, dataset, `metrics_json`, notes) est alimentée par [`publish_model.py`](../training/publish_model.py) — encore vide faute de modèle |

C'est l'écart le plus coûteux au regard du PRD, qui désigne cette page comme le
support du **parcours jury**.

---

## 6. Cas d'utilisation

| ID | Cas d'utilisation | Acteur | Objectif | État |
|---|---|---|---|---|
| **CU-01** | Importer et anonymiser une panoramique | Praticien | Charger un cliché sans exposer de données patient | ✅ |
| **CU-02** | Lancer une détection IA | Praticien | Obtenir numérotation et anomalies proposées | ⚠️ chaîne ✅, détections factices |
| **CU-03** | Réviser et corriger les détections | Praticien | Valider ou ajuster les propositions | ❌ |
| **CU-04** | Générer un rapport PDF annoté | Praticien | Produire un document exploitable et anonyme | ✅ |
| **CU-05** | Consulter l'historique des analyses | Praticien | Retrouver un examen antérieur | ⚠️ API ✅ / UI ❌ |
| **CU-06** | Inspecter les performances du modèle | Porteur / jury | Évaluer objectivement la qualité de l'IA | ❌ |
| **CU-07** | Entraîner / rejouer une évaluation | Porteur | Produire des métriques reproductibles | ⚠️ pipeline présent ([`training/`](../training/)), jamais exécuté — aucune donnée |

**Lecture** : 2 cas sur 7 pleinement couverts, 3 partiels, 2 absents. CU-07 est
passé de absent à partiel : l'outillage existe, les données manquent. CU-03 et
CU-06 restent absents — ce sont eux qui portent la valeur **clinique** et la
**restitution au jury**.

---

## 7. Architecture technique

L'intelligence de l'architecture ne réside pas dans le volume de trafic (faible)
mais dans la **séparation nette entre trois responsabilités** : servir
l'interface, exécuter l'inférence IA, et protéger les données de santé.

### 7.1 Vue d'ensemble

```
                 ┌─────────────┐
   navigateur ──▶│  frontend   │ Next.js (export statique) + nginx — 3000
                 └──────┬──────┘
                        │ /api  (proxy nginx → backend:8000)
                 ┌──────▼──────┐      ┌──────────────┐
                 │   backend   │─────▶│  inference   │ FastAPI (+ YOLO) — 8001
                 │  (FastAPI)  │ HTTP │  ISOLÉ       │ (mock si pas de poids)
                 └───┬─────┬───┘      └──────────────┘
                     │     │
          ┌──────────▼─┐ ┌─▼───────────┐
          │ PostgreSQL │ │   MinIO     │ stockage objet S3
          │ métadonnées│ │ images+PDF  │ 9000 / 9001
          └────────────┘ └─────────────┘
```

| Brique PRD §7.1 | Rôle | Réalisation |
|---|---|---|
| Frontend (React) | Import, revue des détections superposées, consultation des rapports | ✅ Next.js 14 (React 18), export statique servi par nginx |
| Backend API (FastAPI) | Orchestration : import, anonymisation, appel IA, stockage, PDF, authentification | ⚠️ tout sauf l'**authentification** (❌) |
| Service d'inférence IA (PyTorch) | Exécute le modèle, isolé derrière une API interne, GPU possible | ✅ service isolé, registre de versions (paire dents + anomalies), première version entraînée `dentex-2026.11` |
| Base de données (PostgreSQL) | Métadonnées, détections, corrections, versions de modèle. Aucune donnée identifiante | ✅ PostgreSQL 16, 3 tables |
| Stockage objet | Images anonymisées et rapports PDF, chiffrés au repos | ⚠️ MinIO ✅, **chiffrement au repos non activé** |
| Journalisation / audit | Trace horodatée des accès et actions | ❌ non implémenté |

### 7.2 Pourquoi isoler le service d'inférence

Le PRD en fait un principe, le code le respecte strictement : le service
d'inférence **ne reçoit que des pixels**. Il n'a accès ni à la base, ni au
stockage objet, ni à aucune métadonnée d'analyse. Trois bénéfices :

1. **Évolutivité du modèle** — nouvelle version, nouveau framework, sans toucher
   à l'application ;
2. **Dimensionnement indépendant** — le GPU se réserve au seul service qui en a
   besoin ([`docker-compose.gpu.yml`](../docker-compose.gpu.yml)) ;
3. **Traçabilité scientifique** — chaque analyse enregistre quelle version de
   modèle a produit quelle détection : on peut expliquer et rejouer.

### 7.3 Services, ports et démarrage

| Service | Build / image | Ports | Healthcheck |
|---|---|---|---|
| `frontend` | `./frontend` (node:20-alpine → nginx:alpine) | `3000` → `80` | *aucun* |
| `backend` | `./backend` (python:3.11-slim) | `8000` | *aucun* |
| `inference` | `./inference` (python:3.11-slim) | `8001` | `/health`, 10 s, 5 essais |
| `db` | `postgres:16-alpine` | `5432` | `pg_isready`, 5 s, 10 essais |
| `minio` | `minio/minio:latest` | `9000`, `9001` | `mc ready local`, 5 s, 10 essais |

**Ordre de démarrage** : `backend` attend `db` et `minio` *healthy*, mais
seulement le **lancement** de `inference` (`service_started`) — il peut donc
démarrer avant le chargement du modèle, sans conséquence : `/api/health` absorbe
l'indisponibilité et le bandeau frontend se remet au vert au sondage suivant.

**Migrations** : `alembic upgrade head` s'exécute dans le `CMD` du backend, à
chaque démarrage. Le schéma est donc toujours à jour sans étape manuelle.

**Volumes persistants** : `db_data`, `minio_data`. `make clean` les supprime —
**données perdues**.

### 7.4 Choix de PostgreSQL (PRD §7.2)

PostgreSQL apporte les garanties d'intégrité (contraintes, transactions, rôles)
et une traçabilité explicable. Il stocke **uniquement des métadonnées et des
références** — jamais de donnée identifiante — ce qui simplifie la conformité et
maintient la séparation entre l'image (stockage objet) et son index (base).

### 7.5 Traçabilité du modèle (PRD §7.3)

| Exigence | État |
|---|---|
| Chaque analyse enregistre la version du modèle | ✅ `analyses.model_version` + `analyses.inference_mode` |
| Chaque analyse enregistre la version du jeu de données d'entraînement | ⚠️ `model_versions.dataset` est renseignée par `publish_model.py --dataset`, mais le lien `analyses` → `model_versions` passe par la **chaîne de caractères** `model_version`, sans clé étrangère |
| Une détection est toujours reliée au modèle qui l'a produite | ✅ via son analyse |
| Les corrections du praticien sont horodatées et conservées | ❌ colonnes `reviewed`/`source` présentes, sans horodatage ni écriture |

---

## 8. Contrats d'interface

### 8.1 API backend

Toutes les routes sont préfixées par `/api`. Documentation interactive générée
par FastAPI : **http://localhost:8000/docs**.

| Méthode | Route | Description | Réponse |
|---|---|---|---|
| `GET` | `/api/health` | État backend + joignabilité et mode de l'inférence (timeout 3 s, erreurs absorbées) | `{status, inference_reachable, inference_mode}` |
| `POST` | `/api/analyses` | Upload `multipart/form-data`, champ `file` → anonymise, stocke, infère, persiste | `AnalysisOut` |
| `GET` | `/api/analyses` | Résumés, plus récentes d'abord | `AnalysisSummary[]` |
| `GET` | `/api/analyses/{id}` | Détail + détections | `AnalysisOut` |
| `GET` | `/api/analyses/{id}/image` | URL présignée (1 h) vers le PNG anonymisé | `{url}` |
| `POST` | `/api/analyses/{id}/report` | Génère le PDF, le stocke, renvoie une URL présignée | `{url}` |
| `GET` | `/api/model/versions` | Versions de modèle + métriques | `[]` tant qu'aucun modèle n'a été publié par `training/publish_model.py` |

Les routes image et rapport renvoient **une URL présignée** valable 3600 s — pas
une redirection, pas le binaire.

**Exemple de réponse `POST /api/analyses`** :

```json
{
  "id": "9f1c…",
  "created_at": "2026-08-26T10:12:41.223Z",
  "image_key": "images/9f1c….png",
  "report_key": null,
  "model_version": "mock-0.0.0",
  "inference_mode": "mock",
  "width": 1024,
  "height": 512,
  "detections": [
    { "id": "3a2e…", "label": "tooth", "fdi": 11, "confidence": 0.94,
      "x": 64, "y": 180, "w": 64, "h": 85,
      "reviewed": false, "source": "model" }
  ]
}
```

**Codes d'erreur** :

| Code | Cas |
|---|---|
| `400` | Fichier vide |
| `404` | `analysis_id` inconnu |
| `422` | Champ `file` absent (validation FastAPI) |
| `500` | Image/DICOM illisible, inférence indisponible, stockage injoignable |

Schémas Pydantic : [`backend/app/schemas.py`](../backend/app/schemas.py).

### 8.2 Contrat du service d'inférence

C'est le **contrat pivot du projet** : toute implémentation qui le respecte est
substituable sans toucher au backend.

```
GET  /health  → { "status": "ok", "mode": "mock|real", "version": "mock-0.0.0" }
POST /infer   ← multipart, champ `file` (PNG niveaux de gris)
              → { "mode", "model_version", "image_size": {width, height},
                  "detections": [ { "label", "fdi", "confidence", "bbox" } ] }
```

- `bbox` = `[x, y, largeur, hauteur]` en **pixels de l'image reçue** (pas de
  coordonnées normalisées, pas de format `xyxy`) ;
- `label` doit appartenir à la liste des cinq classes (§1.3) ;
- `confidence` est un flottant 0–1, arrondi à 2 décimales ;
- `fdi` est un entier FDI ou `null` — en mode réel il est **déduit** de la géométrie
  des boîtes par [`fdi.py`](../inference/app/fdi.py), jamais prédit par le modèle ;
  `null` signifie « aucune dent ne porte cette anomalie », pas « inconnu ».

Le modèle est chargé **une seule fois** au `startup` du service.

### 8.3 Modèle de données

[`backend/app/models.py`](../backend/app/models.py) (SQLAlchemy 2.0), migré par
Alembic ([`0001_initial`](../backend/alembic/versions/0001_initial.py)).

**`analyses`** — une panoramique anonymisée et son contexte d'inférence

| Colonne | Type | Note |
|---|---|---|
| `id` | `String` (UUID) | clé primaire |
| `created_at` | `DateTime` | UTC |
| `image_key` | `String` | clé stockage objet, `images/<uuid>.png` |
| `report_key` | `String?` | `reports/<id>.pdf`, rempli à la première génération |
| `model_version` | `String` | traçabilité (PRD §7.3) |
| `inference_mode` | `String` | `mock` \| `real` |
| `width`, `height` | `Integer` | dimensions natives, référentiel des bbox |

**`detections`** — une proposition du modèle, ou une correction praticien

| Colonne | Type | Note |
|---|---|---|
| `id` | `String` (UUID) | |
| `analysis_id` | FK → `analyses.id` | `ON DELETE CASCADE`, relation `all, delete-orphan` |
| `label` | `String` | une des cinq classes |
| `fdi` | `Integer?` | numérotation FDI |
| `confidence` | `Float` | 0–1 |
| `x`, `y`, `w`, `h` | `Integer` | pixels |
| `reviewed` | `Boolean` | défaut `false` — **jamais écrit aujourd'hui** |
| `source` | `String` | `model` \| `human` — **toujours `model` aujourd'hui** |

**`model_versions`** — traçabilité des modèles et de leurs métriques (PRD §5.5)

| Colonne | Type | Note |
|---|---|---|
| `version` | `String` unique | ex. `yolov11n-dentex-2026.09` |
| `created_at` | `DateTime` | |
| `dataset` | `String` | jeu et découpage utilisés |
| `metrics_json` | `Text` | mAP par classe, précision, rappel |
| `notes` | `Text` | |

> Écrite par [`training/publish_model.py`](../training/publish_model.py) (`INSERT … ON CONFLICT (version) DO UPDATE`) : republier une même version **écrase** ses métriques.

> **Aucune de ces tables ne contient de donnée identifiante patient** : ni nom,
> ni identifiant, ni date de naissance, ni date d'examen. C'est une propriété du
> schéma lui-même, pas seulement une pratique — il n'existe pas de colonne où
> l'écrire.

---

## 9. Frontend

Next.js 14 (pages router) en **export statique** (`output: "export"`), servi par
nginx qui proxifie `/api` vers le backend. Code organisé en **Feature-Sliced
Design (FSD 2.1)**, habillé par **shadcn/ui** sur **Tailwind CSS v4**.

Le détail complet — couches, segments, règles d'import, design system,
animations — vit dans **[frontend/README.md](../frontend/README.md)**. Résumé
ici de ce qui est structurant pour comprendre la plateforme.

### 9.1 Routes

| Route | Slice | Rôle | Premier chargement |
|---|---|---|---|
| `/` | `views/landing` | Vitrine : présentation de la plateforme, animée avec GSAP | 193 ko |
| `/analyse` | `views/analysis` | **Poste de travail** : import, détections, rapport | **147 ko** |
| `/design-system` | `views/design-system` | Catalogue des 55 composants, en huit onglets | 375 ko |

Le poste d'analyse, seule route réellement utilisée en séance, est la plus
légère : GSAP n'est importé que par la vitrine.

### 9.2 Couches et dépendances

Les imports vont **toujours vers le bas** :

```
app       providers globaux, styles et jetons de design
  ↓
views     pages composées (landing, analysis, design-system)
  ↓
widgets   app-header, detection-viewer
  ↓
features  upload-analysis, generate-report
  ↓
entities  analysis, detection, system-status
  ↓
shared    api, config, lib, ui
```

Deux imports transverses entre entités passent par la notation `@x`, qui rend la
dépendance explicite et limitée :
`detection/@x/analysis` (→ `normalizeDetection`) et
`analysis/@x/system-status` (→ `InferenceMode`).

### 9.3 Conventions structurantes

- **Frontière DTO / modèle.** Le backend parle snake_case (`created_at`,
  `n_detections`, `w`, `h`). Cette forme **s'arrête dans le segment `api/`** :
  au-dessus, tout est camelCase et normalisé.
- **Erreurs normalisées.** [`app-error.js`](../frontend/src/shared/api/app-error.js)
  convertit toute exception axios en `AppError { code, message }` avec un
  message français prêt à afficher (`network`, `timeout`, `validation`,
  `not_found`, `server`, `unknown`). Aucun composant ne manipule d'erreur axios.
- **État asynchrone.** [`use-async-action.js`](../frontend/src/shared/lib/use-async-action.js)
  fournit la machine `idle → pending → success | error` utilisée par les
  features ; `run` ne rejette jamais.
- **Bandeau d'état.** `/api/health` est relu **toutes les 30 s**, sondage
  suspendu quand l'onglet passe en arrière-plan et relancé au retour.
- **Couleurs de détection dupliquées.** `#0F766E` (dent) et `#C0392B` (anomalie)
  existent en jetons OKLCH dans `globals.css` **et** en hexadécimal dans
  `entities/detection` : le canvas ne lit pas les variables CSS. Les deux
  doivent évoluer ensemble.

### 9.4 Design system

Le projet **documente son design par l'application elle-même** :
http://localhost:3000/design-system rend les vrais composants (55 composants,
~290 exports, huit onglets — Fondations, Base, Formulaires, Données, Navigation,
Surcouches, Retours, Métier) et n'appelle aucune API. Il ne peut donc pas
diverger de l'application.

Les composants shadcn sont **copiés dans le dépôt** (`src/shared/ui/`), pas
installés en dépendance ; `shared/ui/index.js` est **généré** par
`npm run ui:index`, qui échoue en cas de collision de noms.

---

## 10. Données, modèle IA et validation

> C'est **la section critique du projet et le cœur scientifique du mémoire**.
> Tout le reste est au service de la preuve produite ici — et c'est aussi la
> section la moins avancée : **rien de ce qui suit n'existe encore dans le
> dépôt.**

> **Le vrai goulot d'étranglement, c'est la donnée.** Le choix du framework de
> détection est secondaire. Ce qui détermine la réussite, c'est la disponibilité
> de panoramiques **annotées par des experts** et la **rigueur de la
> validation**. Un mauvais modèle bien validé est un résultat scientifique ; un
> bon modèle mal validé n'en est pas un.

### 10.1 Stratégie de données (PRD §8.1) — 🔬 à mener

| Dataset | Rôle | Licence / accès |
|---|---|---|
| **DENTEX** | Socle central : panoramiques avec numérotation FDI et diagnostic (caries, caries profondes, lésions périapicales, dents incluses) | Inscription au challenge Grand Challenge ; usage académique ; **usage commercial à ne pas présumer** |
| **UFBA-425** | Démarrage immédiat, renfort détection/numérotation | **CC BY 4.0** — la plus permissive, réutilisable y compris commercialement |
| **Tufts Dental** (1 000 panoramiques) | Renfort qualité et diversité pour la détection des dents | Demande académique via portail officiel ; **anticiper le délai** |

**Séquence de mise en œuvre** : UFBA-425 pour démarrer immédiatement
(téléchargement direct) → DENTEX comme socle central dès l'accès obtenu → Tufts
en complément (demande à lancer sans attendre, délai long).

**Ce qui n'a aucune donnée : kystes et fractures.** Aucun dataset panoramique
annoté ne les couvre. Hors périmètre, passés en perspectives.

### 10.2 Choix du modèle (PRD §8.2)

**Recommandation retenue : YOLOv11 sous PyTorch** — pas Detectron2, pas de
Vision Transformer. Pour un mémoire de 12 semaines avec un budget GPU limité,
YOLO offre un entraînement rapide, un outillage mûr et des résultats fiables en
détection à boîtes englobantes. Detectron2 alourdirait la mise en œuvre sans
bénéfice décisif ; un ViT demanderait bien plus de données. **Les alternatives
sont discutées dans le mémoire pour montrer qu'elles sont connues — une seule
est implémentée, et bien.**

DENTEX a une structure hiérarchique (quadrant → numérotation → diagnostic) : un
même pipeline sert les deux tâches. Deux architectures restent ouvertes
(décision PRD §14.2) : **détection unique multi-classes**, ou **deux étapes**
(dents d'abord, puis rattachement des anomalies).

> **Ce que le code a déjà tranché de fait** : le contrat `POST /infer` (§8.2)
> renvoie une **liste plate de détections multi-classes en un seul appel**. Une
> architecture en deux étapes reste possible — elle serait interne au service
> d'inférence — mais elle devrait produire ce même contrat de sortie. Le backend
> et le frontend n'ont pas à savoir laquelle est utilisée.

### 10.3 Méthodologie de validation (cœur du mémoire) — 🔬 à mener

| Exigence | Ce qu'elle impose |
|---|---|
| **Découpage propre train / validation / test sans fuite** | Aucune image d'un même patient répartie entre plusieurs partitions |
| **Jeu de test indépendant gelé** | Jamais vu pendant l'entraînement, sert à la mesure finale et à elle seule |
| **Métriques chiffrées par classe** | mAP@0.5, mAP@0.5:0.95, précision, rappel — et pour l'usage clinique **sensibilité / spécificité** |
| **Gestion du déséquilibre des classes** | Les caries sont bien plus fréquentes que les dents incluses : rapporter **par classe**, jamais une moyenne globale seule |
| **Analyse qualitative des échecs** | Galerie des faux positifs / faux négatifs typiques — indispensable à un mémoire honnête |

**Ce que `training/` implémente déjà** — le protocole ci-dessus est outillé, il
n'attend que les données :

| Exigence | Outil |
|---|---|
| Découpage sans fuite | [`prepare_dataset.py`](../training/prepare_dataset.py) découpe **par patient**, jamais par image |
| Test gelé et reproductible | `split.json` consigne graine, ratios et affectation patient par patient — le découpage est rejouable *et prouvable* |
| Métriques par classe | [`evaluate.py`](../training/evaluate.py) : mAP@0.5, mAP@0.5:0.95, précision, rappel, par classe |
| Sensibilité / spécificité | Calculées **au niveau image** — la spécificité n'existe pas en détection pure (aucun « vrai négatif » sur une boîte jamais proposée) ; elle retrouve un sens sur la question clinique : *ce cliché porte-t-il au moins une carie ?* |
| Déséquilibre des classes | `prepare_dataset.py` affiche la distribution par classe et par partition |
| Analyse qualitative des échecs | ❌ galerie FP/FN non outillée |

**Où ces résultats atterrissent dans la plateforme** : la table
`model_versions` (§8.3) est conçue pour les accueillir — `version`, `dataset`,
`metrics_json`, `notes` — et `GET /api/model/versions` les expose déjà.
[`publish_model.py`](../training/publish_model.py) écrit dedans. Il manque les
**mesures** et la **page de restitution** (PRD §5.5).

### 10.4 Le mode mock — et pourquoi il existe

Tant qu'aucun fichier de poids n'est présent, le service d'inférence démarre en
mode `mock` et renvoie des détections **factices mais plausibles**
([`inference/app/model.py`](../inference/app/model.py)) :

- 6 à 12 boîtes `tooth` réparties sur l'arcade, confiance 0,80–0,99 ;
- jusqu'à 3 anomalies tirées au sort (confiance 0,55–0,90) qui **réutilisent la
  boîte exacte et le FDI d'une dent** — la superposition est attendue ;
- le générateur est initialisé sur `width × height` : les détections sont
  **déterministes pour une taille d'image donnée**, ce qui rend un test
  bout-en-bout reproductible à peu de frais.

**Ce mode n'a aucune valeur diagnostique** et l'interface le dit explicitement
(badge `mock` + avertissement). Sa raison d'être : valider l'intégralité de la
chaîne — import, anonymisation, stockage, transport, persistance, rendu, PDF —
**avant** d'avoir un modèle, donc sans que l'application soit sur le chemin
critique du travail scientifique.

### 10.5 Brancher le vrai modèle

1. **Entraîner** — [`training/`](../training/), voir
   [training/README.md](../training/README.md). L'ordre des classes est vérifié
   automatiquement : `train.py` **refuse de démarrer** si le `data.yaml` dévie de
   [`config.py`](../inference/app/config.py).
2. **Publier** — `python training/publish_model.py … --install` dépose les poids
   dans `inference/weights/model.pt` (monté en lecture seule, `*.pt` exclus du
   dépôt par `.gitignore`) et écrit les métriques dans `model_versions`.
3. Décommenter `ultralytics` dans
   [`inference/requirements.txt`](../inference/requirements.txt) **et** le bloc
   `torch` du [`Dockerfile`](../inference/Dockerfile).
4. Renseigner `MODEL_VERSION`, **`MODEL_STRICT=1`** et `MODEL_IMAGE_SIZE` dans
   `.env`.
5. `docker compose up --build` — **le rebuild est obligatoire.**

> ⚠️ **Sans `MODEL_STRICT=1`, un échec de chargement fait retomber le service en
> mock sans erreur** (message `échec du chargement du modèle` dans les logs) : on
> mesure alors du bruit en croyant mesurer un modèle. Avec `MODEL_STRICT=1`, le
> service refuse de démarrer. Toujours vérifier :
> `curl http://localhost:8001/health` doit répondre `"mode":"real"`.

**Ce qui reste à faire côté service** en mode réel : le **prétraitement
identique à l'entraînement** (§5.1) — `MODEL_IMAGE_SIZE` existe, mais rien ne
vérifie qu'il correspond au `--imgsz` employé. La numérotation FDI, elle, n'est
plus un manque : [`fdi.py`](../inference/app/fdi.py) la déduit de la géométrie.

---


### 10.6 Premier modèle entraîné : `dentex-2026.11` (sprint 6)

Rapport complet, figures comprises : [docs/evaluation/dentex-2026.11/rapport.md](evaluation/dentex-2026.11/rapport.md).

- **Données** : DENTEX (Hugging Face, révision figée), CC BY-NC-SA 4.0 — les
  poids héritent de la restriction académique. Deux jeux, parce que DENTEX
  encadre toutes les dents dans un ensemble et seulement les dents malades dans
  l'autre : modèle **dents** et modèle **anomalies**. Un seul découpage
  (graine 42, empreinte `f22d373ede0ff715`, identique sur deux machines), par
  groupe de clichés identiques au pixel près ; le test officiel sert de test
  externe.
- **Entraînement** : YOLO11s préentraîné COCO, 1024 px, Colab (Tesla T4) ;
  arrêt anticipé à 113 et 60 époques.
- **Test interne, évalué une fois** :

| Modèle | Classe | Instances | Précision | Rappel | mAP@0,50 |
|---|---|---|---|---|---|
| dents | dent | 2 445 | 0,977 | 0,989 | **0,987** |
| anomalies | dent incluse | 94 | 0,846 | 0,932 | 0,927 |
| anomalies | carie | 332 | 0,490 | 0,416 | 0,493 |
| anomalies | carie profonde | 76 | 0,465 | 0,401 | 0,371 |
| anomalies | lésion péri-apicale | 22 | 0,369 | 0,318 | 0,248 |
| anomalies | **global** | | 0,542 | 0,517 | **0,510** |

- **Test externe** (test officiel, autre protocole, 3 classes) : mAP@0,50
  0,585 — carie 0,458, dent incluse 0,901, lésion péri-apicale 0,397.
- **Lecture** : le test interne fait foi ; la validation de la meilleure époque
  (0,587) est optimiste, puisqu'elle a servi à choisir l'époque. La détection
  des dents et des inclusions est solide ; celle des caries et surtout des
  lésions péri-apicales (22 exemples au test) ne l'est pas encore — c'est la
  principale limite à présenter, et le premier axe d'amélioration (plus de
  données annotées, taille d'image plus grande pour les petites lésions).

### 10.7 Numérotation hybride et schéma dentaire (sprint 7)

**Pourquoi changer.** La règle purement géométrique du sprint 6 numérote
correctement 74,8 % des dents sur la validation (boîtes vraies) ; de bout en
bout, avec `dentex-2026.11`, 74,7 % des dents et seulement **55 % des
anomalies** reçoivent le bon numéro. L'erreur vient du rang (une dent absente
décale toutes ses voisines), pas du quadrant.

**Méthode retenue : hybride.** Le modèle des dents apprend le **rang** (huit
classes `dent_1` … `dent_8`, jeu `rangs`, même découpage `f22d373ede0ff715`) ;
la géométrie donne le **quadrant** : médiane au centre des incisives (rangs 1
et 2), plan d'occlusion par 2-moyennes. Plafond mesuré sur la validation avec
des rangs parfaits : **99,2 %** des dents (98,0 % si la médiane est le milieu
de l'image). Tous les réglages se font sur la validation ; le test interne
n'est mesuré qu'**une fois**, à la fin (registre
`mesures_numerotation_test.jsonl`).

**Incohérences signalées, jamais corrigées d'office.** Recalculées par le
serveur à partir des numéros *retenus* ([`numerotation.py`](../backend/app/services/numerotation.py)) :
corriger un numéro fait disparaître le signalement.

| Type | Quand |
|---|---|
| `doublon` | deux dents portent le même numéro |
| `ordre` | dans un quadrant, une dent plus éloignée de la médiane a un rang plus petit |
| `quadrant_surcharge` | plus de huit dents dans un quadrant |
| `absente_detectee` | une dent déclarée absente porte une détection |

**Rattachement anomalie → dent.** Part de l'anomalie couverte par la dent
≥ 0,20 (98,4 % de rattachements justes avec les boîtes vraies, contre 97,1 % à
0,5) ; pour une lésion péri-apicale, la boîte de la dent est prolongée de
25 % vers l'apex. Le lien est stocké : une dent renumérotée emporte ses
anomalies, sauf si le praticien a fixé lui-même le numéro de l'anomalie.

**Schéma dentaire (odontogramme).** SVG des 32 dents, cliquable et navigable
au clavier (flèches, Entrée, Échap). États : présente, porteuse d'anomalie,
déclarée absente, non détectée ; numéro à vérifier en orange **et** suivi d'un
« ? » (lisible en niveaux de gris). La fiche d'une dent permet de changer son
numéro en le désignant dans le schéma, de rejeter la détection, de déclarer la
dent absente ou de retirer la déclaration — chaque geste est journalisé.
Export PNG au nom anonyme (`odontogramme-<référence>.png`).

**Typologie des anomalies.** Urgence **indicative** : un ordre de relecture,
jamais un diagnostic. La forme double la couleur : carie profonde et dent
incluse ont presque la même luminance (test automatique).

| Type | Abrév. | Marque | Urgence indicative | Définition affichée |
|---|---|---|---|---|
| Carie profonde | CP | carré | prioritaire | atteint la dentine profonde, près de la pulpe |
| Lésion péri-apicale | LPA | losange | prioritaire | zone sombre autour de l'apex, d'origine pulpaire le plus souvent |
| Carie | C | rond | à programmer | zone radio-claire de la couronne, à distance de la pulpe |
| Dent incluse | DI | triangle | à surveiller | dent restée dans l'os, sans éruption |

**Résumé et filtres.** Tableau type × quadrant des anomalies retenues (au-dessus
du seuil, hors rejetées), types rangés par urgence ; chaque case filtre la
liste. Filtres par quadrant, par type et par dent (depuis le schéma).

**État.** Code, tests et parcours de bout en bout en place. Le modèle
`rangs-v1` reste à entraîner (Colab, cellules 5 ter et 6 bis) ; sa mesure de
numérotation et la version `dentex-2026.11b` (rangs-v1 + anomalies-v1)
compléteront cette section.

### 10.8 Détection des anomalies : diagnostic et seuils d'exploitation

**Diagnostic de `anomalies-v1`** (validation seulement ; le test n'a pas servi).
L'hypothèse « petites lésions trop réduites » est **réfutée** : aucune lésion
annotée ne mesure moins de 32 px à 1 024 px (les boîtes DENTEX sont grandes),
et les caries de plus de 64 px ne sont trouvées qu'à 41 %. Le cadre n'est pas
en cause non plus (recouvrement exigé 0,3 au lieu de 0,5 : presque aucun
gain). Le modèle **voit** la plupart des lésions, mais avec une confiance
basse, au niveau de ses fausses alertes :

| Classe | Rappel à 0,25 | à 0,10 | à 0,01 |
|---|---|---|---|
| Carie | 39 % | 60 % | 89 % |
| Lésion péri-apicale | 36 % | 60 % | 88 % |
| Carie profonde | 44 % | 49 % | 58 % (le reste pris pour une carie) |
| Dent incluse | 94 % | 96 % | 98 % |

Il manque de pouvoir de discrimination plus que de résolution : les essais
« anomalies v2 » (carnet Colab, cellules 8 à 8 ter) portent d'abord sur la
capacité du modèle (YOLO11m) et le rééquilibrage des classes rares
(`--reequilibrage`, méthode LVIS) ; le modèle se choisit sur la validation
(`comparer_essais.py`), seul le retenu passe le test, une fois. Un score de
0,99 n'est pas un objectif atteignable sur panoramique : l'accord entre
experts y est lui-même modéré pour les caries et les lésions débutantes.

**Seuils d'exploitation par classe.** Un seuil unique (0,25) ne convient pas
à toutes les classes. [`seuils_exploitation.py`](../training/seuils_exploitation.py)
retient, sur la validation, le plus haut seuil qui atteint la sensibilité
visée, entre le plancher du service d'inférence (0,10 : en dessous, rien
n'est conservé) et l'ancien seuil global (0,25 : aucune classe ne perd en
sensibilité). Choix retenu pour `anomalies-v1`, cible 70 % :

| Classe | Seuil | Sensibilité | Précision | Fausses alertes / cliché |
|---|---|---|---|---|
| Carie | 0,10 | 60 % | 37 % | 3,65 |
| Carie profonde | 0,10 | 49 % | 44 % | 0,44 |
| Lésion péri-apicale | 0,10 | 60 % | 35 % | 0,25 |
| Dent incluse | 0,25 | 94 % | 72 % | 0,27 |

Environ 4,6 fausses alertes par cliché à rejeter, contre 1,9 au seuil
unique de 0,25, pour une sensibilité des caries et des lésions
péri-apicales qui passe de 36–39 % à 60 %. Le plancher de 0,05 (71–72 %,
environ 6,9 fausses alertes) a été écarté.

Les seuils sont **publiés avec la version** (`publish_model.py`, refusés s'ils
ont été calculés pour d'autres poids ou hors validation) et **recopiés sur
chaque analyse** au traitement (migration 0012). Une anomalie est *proposée*
si sa confiance atteint le seuil de sa classe : elle attend un verdict avant
la clôture. Sous le seuil, elle reste visible (« Facultative »), peut recevoir
un verdict, mais ne l'exige pas et n'entre pas au compte rendu sans verdict.
À l'écran, chaque classe suit son seuil ; le curseur les remplace pour
regarder au-delà. Versions sans seuils : comportement antérieur.

## 11. Sécurité, confidentialité et conformité réglementaire

> **Le point réglementaire à ne pas ignorer.** Un « logiciel d'aide au
> diagnostic » est juridiquement un **dispositif médical** (règlement européen
> MDR, ou FDA aux États-Unis). Aucune certification n'est attendue pour un
> mémoire, mais **l'ignorer est une faille que le jury remarquera**. Le projet
> se positionne explicitement comme **prototype de recherche non destiné à
> l'usage clinique**, mention portée sur l'interface et sur chaque rapport.

### 11.1 Protection des données de santé (PRD §9.1)

| Exigence | État | Mise en œuvre |
|---|---|---|
| **Anonymisation dès l'import**, avant tout stockage | ✅ | 13 tags DICOM écrasés ; EXIF supprimé par ré-encodage PNG ; l'original n'est **jamais** écrit sur disque |
| **Séparation image / index** | ✅ | Aucune donnée identifiante en base ; images et PDF dans le stockage objet |
| **Chiffrement au repos** | ❌ | À activer côté S3 (SSE) — non configuré sur MinIO en local |
| **Chiffrement en transit (HTTPS)** | ❌ | HTTP en développement ; terminaison TLS à ajouter devant nginx |
| **Contrôle d'accès (JWT)** | ❌ | `python-jose` est provisionné et `JWT_SECRET` existe, **aucune route n'est protégée** |
| **Journalisation horodatée** des accès et actions | ❌ | Non implémentée |

### 11.2 Conformité RGPD (PRD §9.2)

| Exigence | État |
|---|---|
| **Minimisation** — ne traiter que des panoramiques anonymisées | ✅ par conception du schéma |
| **Base légale et consentement** si données réelles | 🔬 privilégier les datasets publics anonymisés |
| **Résidence des données en UE** | 🔬 décision d'hébergement, hors code |
| **Licences des datasets respectées** | 🔬 usage académique pour DENTEX et Tufts ; seul **UFBA-425 (CC BY 4.0)** autorise clairement un usage commercial — à retenir pour un futur volet SaaS |

### 11.3 Cadre du prototype (PRD §9.3)

| Exigence | État | Où |
|---|---|---|
| Mentions « aide au diagnostic — décision réservée au praticien » et « prototype non certifié » sur l'interface | ✅ | en-tête de `/analyse`, vitrine, README |
| Mêmes mentions sur chaque rapport | ✅ | pied de page du PDF |
| Aucune formulation de diagnostic affirmatif | ✅ | vocabulaire de signalement partout (§2) |

### 11.4 Avant toute mise en production

La configuration actuelle vise le **développement local**. Liste bloquante :

- [ ] Restreindre le CORS (actuellement `allow_origins=["*"]`)
- [ ] Changer `JWT_SECRET`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY` / `S3_SECRET_KEY`
- [ ] Ne plus exposer `5432`, `9000`, `9001`, `8001` sur l'hôte
- [ ] Activer HTTPS (terminaison TLS devant nginx)
- [ ] Ajouter authentification et contrôle d'accès sur les routes
- [ ] **Traiter les annotations incrustées dans les pixels** (§5.1)
- [ ] Héberger dans l'UE, activer le chiffrement au repos côté S3
- [ ] Journalisation d'audit, rétention, sauvegardes
- [ ] Épingler les images de base (`minio/minio:latest` n'est pas reproductible)

---

## 12. Exigences non fonctionnelles

| Exigence PRD §10 | Cible | État constaté |
|---|---|---|
| **Performance d'inférence** | Quelques secondes sur GPU, dégradation acceptable sur CPU | ⚠️ mock quasi instantané ; jamais mesuré avec un vrai modèle. Timeouts en place : axios 120 s, client d'inférence 60 s, nginx 60 s implicite |
| **Qualité du modèle** | Métriques par classe rapportées, objectif chiffré fixé et publié | ⚠️ aucune métrique produite, mais [`evaluate.py`](../training/evaluate.py) les calcule par classe — décision PRD §14.1 toujours non tranchée |
| **Fiabilité** | Aucune analyse perdue ; toute erreur d'inférence tracée et rejouable | ❌ une inférence en échec renvoie `500` et **rien n'est persisté** ; aucune reprise, aucune trace |
| **Confidentialité** | Aucune donnée identifiante stockée ; anonymisation vérifiée | ⚠️ garanti par le schéma ✅ et testé unitairement ✅ — sauf pixels incrustés |
| **Traçabilité** | Chaque détection reliée à une version de modèle et de dataset | ⚠️ modèle ✅, dataset : colonne alimentable par `publish_model.py`, reliée par chaîne de caractères et non par clé étrangère |
| **Reproductibilité** | Entraînement et évaluation rejouables (graines, versions, données figées) | ⚠️ mock déterministe ✅, images Docker et lockfiles ✅, découpage à graine fixe tracé dans `split.json` ✅, `run.json` consigne hyperparamètres et empreinte git ✅ — jamais exécuté ❌ |
| **Accessibilité** | Application web responsive desktop + mobile | ✅ Tailwind responsive, `aria-hidden` sur les icônes décoratives |
| **Maintenabilité** | Service IA isolé, remplaçable sans toucher à l'application | ✅ contrat HTTP stable (§8.2) |

### Stack recommandée (PRD §11) contre stack réelle

| Composant | Recommandé | Réalisé |
|---|---|---|
| Frontend | React | ✅ Next.js 14 / React 18, FSD, shadcn/ui, Tailwind v4 |
| Backend / API | FastAPI (Python) | ✅ FastAPI 0.111 |
| Modèle de détection | YOLOv11 sous PyTorch | ✅ deux modèles YOLO11s (dents, anomalies) entraînés sur DENTEX, ultralytics 8.3.40 et torch 2.3.1 dans l'image du service — voir §10.6 |
| Base de données | PostgreSQL | ✅ PostgreSQL 16 + SQLAlchemy 2 + Alembic |
| Stockage objet | Stockage chiffré | ⚠️ MinIO (S3-compatible), chiffrement non activé |
| Conteneurisation | Docker | ✅ Docker Compose, override GPU |
| Intégration continue | GitHub Actions | ✅ 4 jobs (voir §13.3) |
| Génération PDF | Bibliothèque côté backend | ✅ ReportLab |
| Suivi des expériences | Journalisation des runs | ⚠️ `run.json` par entraînement et `model_versions` en base ; aucun outil dédié (MLflow, W&B) |

**Ce qui a été retiré volontairement** (PRD §11) : n8n et les intégrations
OpenAI / Supabase / Drive / Gmail du cahier des charges initial. Le code n'en
porte aucune trace — cohérence confirmée.

---

## 13. Déploiement et exploitation

### 13.1 Environnements

| Environnement | Usage | Commande |
|---|---|---|
| **Local (CPU)** | Développement quotidien, démonstration sans GPU | `docker compose up --build` ou `make up` |
| **Local (GPU)** | Inférence avec un modèle réel | `make up-gpu` — applique [`docker-compose.gpu.yml`](../docker-compose.gpu.yml), réserve un GPU NVIDIA et passe `TORCH_VARIANT=gpu` |
| **Démonstration (soutenance)** | Même image, jeu de panoramiques préparé | 🔬 jeu de démonstration à constituer |

Le PRD prévoit une **préproduction** ; elle n'existe pas aujourd'hui.

### 13.2 Variables d'environnement

Copier [`.env.example`](../.env.example) en `.env` (jamais committé).

| Variable | Défaut | Description |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `panoradent` | PostgreSQL |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `minioadmin` | Stockage objet (= `MINIO_ROOT_*`) |
| `S3_BUCKET` | `panoradent` | Bucket, créé à la volée |
| `MODEL_VERSION` | `mock-0.0.0` | **Version tracée dans chaque analyse** |
| `JWT_SECRET` | `change-me-in-prod` | à changer |

**Écrites en dur dans le compose**, non surchargeables : `DATABASE_URL`,
`S3_ENDPOINT`, `INFERENCE_URL`, `MODEL_WEIGHTS_PATH`.

Côté frontend, `NEXT_PUBLIC_API_BASE` (défaut `/api`) est une variable **de
build** : Next l'inline au `npm run build`, la définir au runtime nginx n'a
aucun effet.

### 13.3 Intégration continue

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — quatre jobs en
parallèle sur `push` vers `main` et sur chaque pull request :

| Job | Contenu |
|---|---|
| `backend` | `pip install -r requirements.txt` puis `pytest -q` |
| `inference` | `pip install -r requirements.txt` puis `pytest -q` |
| `frontend` | `npm ci` puis `npm run build` |
| `compose-build` | `docker compose build` — vérifie que les trois images se construisent |

**Aucun linter, aucune porte de couverture.** Le pipeline
[`training/`](../training/) n'est pas couvert : il exige torch et un GPU.

### 13.4 Tests

```bash
make test                    # backend + inférence (stack démarrée)
cd backend   && pytest -q    # en local
cd inference && pytest -q
```

**Backend — un seul test**, sur l'anonymisation
([`test_anonymize.py`](../backend/app/tests/test_anonymize.py)) : niveaux de
gris, dimensions conservées, ré-encodage PNG sans EXIF. Il couvre précisément
l'exigence de confidentialité la plus sensible — c'est le bon test à avoir si
l'on n'en a qu'un.

**Inférence — neuf tests** sur la numérotation FDI
([`test_fdi.py`](../inference/app/tests/test_fdi.py)) : denture complète couvrant
les quatre quadrants, convention droite patient / gauche image, héritage du
numéro par les anomalies, plan d'occlusion déduit malgré un cadrage décentré,
arcade unique, écrêtage à la huitième position. Depuis le sprint 7,
[`test_numerotation.py`](../inference/app/tests/test_numerotation.py) couvre la
numérotation hybride (rang appris, médiane des incisives, incohérences,
rattachement à 0,20 et prolongement vers l'apex). Ils n'exigent ni image ni
modèle entraîné.

**Ni l'API, ni le stockage, ni le pipeline d'entraînement ne sont testés.** Le
mock étant déterministe, un test bout-en-bout serait peu coûteux à écrire
(voir §16).

### 13.5 Séparation entraînement / service

Principe du PRD §12, respecté par construction et désormais **matérialisé** par
[`training/`](../training/) : **l'entraînement est un processus hors ligne**. Ce
dossier n'est embarqué dans aucun conteneur, n'apparaît dans aucun `Dockerfile`
et ne tourne pas dans la stack — il s'exécute sur Colab ou sur une machine GPU.
Seul le modèle figé (poids versionnés) est déployé pour l'inférence, monté en
lecture seule dans le conteneur. Aucun code d'entraînement ne vit dans le
service qui sert les prédictions.

Conséquence pratique : les imports d'`ultralytics` sont **tardifs** dans
`train.py` et `evaluate.py`, si bien que leurs garde-fous (ordre des classes,
cohérence des métriques) restent vérifiables sans torch ni GPU.

---

## 14. Limites connues

### Fonctionnel

- **Revue praticien non implémentée** — colonnes présentes, aucune route ni UI.
  Le PDF est donc un document **non validé**.
- **Pas d'authentification** ; aucune route `DELETE`.
- **Pas d'historique dans l'UI** bien que `GET /api/analyses` existe.
- **Table `model_versions` vide** — alimentable par
  [`publish_model.py`](../training/publish_model.py), mais la **page** de
  performance reste à écrire.

### Modèle

- **Aucun modèle entraîné** : les détections sont **factices** et sans valeur
  diagnostique.
- **Aucun dataset obtenu** : le pipeline [`training/`](../training/) est écrit
  mais **n'a jamais tourné de bout en bout** — `train.py` et `evaluate.py`
  exigent torch et un GPU, indisponibles sur la machine de développement.
- **Bascule mock silencieuse** si les poids sont illisibles — sauf à poser
  `MODEL_STRICT=1`, qui la transforme en refus de démarrage.
- **Seuil de confiance côté service uniquement** (`MODEL_CONF_THRESHOLD`),
  non réglable depuis l'UI et ignoré en mock.
- **Le FDI du mock ne vient pas de [`fdi.py`](../inference/app/fdi.py)** : le
  générateur produit ses propres numéros, incohérents avec l'arcade. Seul le
  mode réel emprunte la déduction géométrique.
- **Structure DENTEX vérifiée** (sprint 6) — catégories lues par leur nom,
  géométrie des quadrants contrôlée sur les quatre ensembles annotés
  ([`training/dentex.py`](../training/dentex.py)).

### Infrastructure

- **URLs présignées non résolvables depuis le navigateur** — signées avec
  `S3_ENDPOINT=http://minio:9000`, nom interne au réseau Docker. L'analyse et la
  génération du PDF côté serveur fonctionnent ; le viewer **dégrade proprement**
  (« Image non affichable… »). Contournements : ajouter `127.0.0.1 minio` au
  fichier `hosts`, ou dissocier endpoint interne et endpoint public de signature
  (correctif recommandé, voir §16).
- **`VITE_API_BASE` dans le compose** est un reliquat de la migration Vite →
  Next.js, sans effet ; le frontend retombe sur `/api`, qui est la bonne valeur.
- **`package.json` / `package-lock.json` à la racine** déclarent
  `gsap-animations-lionel`, importé nulle part. Supprimables.
- **Timeout nginx à 60 s sur `/api/`** — une analyse lente en mode réel peut
  être coupée en `504` avant que le backend n'abandonne (axios patiente 120 s).
- **PDF sans accents** et **noms de classes en anglais**.
- **Thème sombre non appliqué** à l'application (jetons `.dark` prévisualisables
  sur `/design-system`, couleurs de tracé du canvas figées en clair).
- **Pas de healthcheck** backend ni frontend dans Compose.
- **Couverture de tests faible** — anonymisation et numérotation FDI seulement ;
  ni l'API, ni le stockage, ni le pipeline d'entraînement ; `Makefile` :
  `up-gpu` absent de `.PHONY`, cibles `build` / `seed` / `fmt` déclarées sans
  corps.

---

## 15. Risques et décisions

### 15.1 Risques (PRD §13) et état de la mitigation

| Risque | Gravité | Mitigation prévue | État |
|---|---|---|---|
| Données annotées insuffisantes pour une classe | Critique | Socle DENTEX validé tôt ; métriques par classe ; réduire le périmètre si une classe est trop pauvre | 🔬 **non engagée** — accès datasets non démarré |
| Accès aux datasets retardé (Tufts, DENTEX) | Élevé | Démarrer sur UFBA-425 ; lancer les demandes dès la semaine 1 | 🔬 **non engagée** — risque le plus urgent |
| Périmètre trop ambitieux pour 12 semaines | Critique | Recentrage acté ; kystes/fractures en perspectives ; n8n retiré | ✅ **tenu** — le code ne contient rien de hors périmètre |
| Validation faible ou non reproductible | Critique | Découpage sans fuite, test gelé, métriques chiffrées, rédaction au fil de l'eau | ⚠️ **outillée, non exécutée** — `prepare_dataset.py` et `evaluate.py` implémentent le protocole ; aucune donnée pour le lancer |
| Sur-ingénierie de l'application | Moyen | UI minimale ; règle « est-ce que ça renforce la preuve ? » | ⚠️ **point de vigilance** — le design system (55 composants, 375 ko) et la vitrine animée dépassent le strict nécessaire à la preuve |
| Fuite de données de santé | Élevé | Anonymisation, chiffrement, séparation image/index, datasets publics | ⚠️ anonymisation ✅, chiffrement ❌, pixels incrustés ❌ |
| Confusion aide au diagnostic / diagnostic | Élevé | Signalements non affirmatifs, mentions prototype, praticien décideur | ✅ **tenu** partout |
| Mauvaise interprétation réglementaire | Moyen | Positionnement prototype assumé et documenté | ✅ **tenu** |

### 15.2 Décisions à trancher (PRD §14)

| # | Décision | État |
|---|---|---|
| 1 | **Objectif de performance chiffré** — quel mAP@0.5 valide le projet ? | ⏳ **ouverte** — à fixer et justifier au regard de la littérature. Bloque le KPI principal |
| 2 | **Architecture du modèle** — détection unique multi-classes ou deux étapes ? | ⏳ ouverte. Le contrat d'inférence n'impose rien (§10.2) : les deux restent évaluables |
| 3 | **Nombre de classes d'anomalies retenues** selon la richesse réelle de DENTEX | ⏳ ouverte. Le code en déclare **4** — changer ce nombre impose de toucher `inference/app/config.py` **et** `entities/detection` |
| 4 | **Vérité-terrain de validation** — DENTEX seul, ou complément expert ? | ⏳ ouverte |
| 5 | **Volet SaaS** — perspective ou amorce ? | ⏳ ouverte. Si amorce : **UFBA-425 (CC BY 4.0) est le seul dataset clairement réutilisable commercialement** |
| 6 | **Périmètre de l'anonymisation** — quels champs DICOM, quelle vérification ? | ⚠️ **partiellement tranchée par le code** : 13 tags, vérifiés par un test unitaire. Reste à statuer sur les **pixels incrustés** |

### 15.3 Décisions déjà tranchées par le code

Elles ne figurent pas au PRD mais engagent la suite :

| Décision | Conséquence |
|---|---|
| **Contrat d'inférence `bbox = [x, y, w, h]` en pixels** | Tout modèle branché doit convertir depuis `xyxy` ou des coordonnées normalisées |
| **Ordre des cinq classes figé** | L'indice YOLO est mappé positionnellement : l'entraînement **doit** respecter cet ordre |
| **Image redimensionnée à `MODEL_IMAGE_SIZE`** (640) en mode réel, native en mock | Le `--imgsz` d'entraînement doit valoir la même chose ; rien ne le vérifie (§5.1) |
| **Numérotation FDI hybride** (sprint 7) | Le modèle apprend le rang, jamais le quadrant : `fdi.py` place la médiane et le plan d'occlusion. Les classes d'un modèle sont lues dans ses poids ; un modèle à cinq classes reste numéroté par la géométrie seule |
| **Une analyse = une inférence, synchrone** | Pas de file d'attente ; une inférence longue tient la requête HTTP ouverte |
| **Échec d'inférence = `500`, rien n'est persisté** | Contredit l'exigence de fiabilité « aucune analyse perdue » (§12) |

---

## 16. Critères de succès et feuille de route

### 16.1 KPIs (PRD §15)

| Indicateur | Cible mémoire | État |
|---|---|---|
| **Performance de détection** — mAP@0.5 sur le test indépendant | Cible à fixer (décision §15.2-1), justifiée | ✅ mesurée (§10.6) : dents 0,987, anomalies 0,510 (test interne) ; cible encore à fixer |
| **Sensibilité clinique** — rappel sur caries et lésions périapicales | Élevé (faux négatifs coûteux) | ⚠️ mesurée, insuffisante : rappel carie 0,42, lésion péri-apicale 0,32 (22 boîtes) |
| **Reproductibilité** — évaluation rejouable à l'identique | 100 % | ✅ découpage par graine, empreinte identique sur deux machines ; test évalué une seule fois (registre) |
| **Couverture du périmètre** — numérotation + 4 classes fonctionnelles | Démontré de bout en bout | ✅ de bout en bout avec le vrai modèle ; numérotation FDI géométrique à fiabiliser (sprint 7) |
| **Chaîne complète** — import → inférence → revue → PDF | Opérationnelle en démo | ⚠️ **la revue manque** |
| **Confidentialité** — anonymisation vérifiée sur tout le flux | Aucune fuite identifiante | ⚠️ vérifiée hors pixels incrustés |
| **Qualité du mémoire** — méthodologie et analyse des échecs documentées | Complètes et honnêtes | 🔬 en cours |

### 16.2 Feuille de route 12 semaines (PRD §16) et avancement

| Période | Jalons | Avancement |
|---|---|---|
| **Sem. 1–2** | État de l'art · demandes d'accès datasets · démarrage UFBA-425 · préparation et découpage des données | ⚠️ **outillage prêt ([`prepare_dataset.py`](../training/prepare_dataset.py)), demandes d'accès non lancées — chemin critique** |
| **Sem. 3–6** | Modèle IA : détection/numérotation, puis anomalies · premières évaluations | ⚠️ pipeline écrit ([`train.py`](../training/train.py), [`evaluate.py`](../training/evaluate.py)), entraînement non démarré |
| **Sem. 7–9** | Application : backend et frontend, chaîne de bout en bout | ✅ **fait, et en avance** |
| **Sem. 10–11** | Validation rigoureuse : test gelé, métriques par classe, analyse des échecs | 🔬 non démarré |
| **Sem. 12** | Finalisation du mémoire · soutenance · jeu de démonstration | 🔬 à venir |

> **Le chemin critique.** Deux tâches ne se rattrapent pas avec plus de moyens :
> l'**accès aux données annotées** (délais d'inscription indépendants du travail
> fourni) et la **validation rigoureuse** (qui exige un jeu de test propre et du
> temps d'analyse). Elles doivent démarrer dès la semaine 1 et être planifiées
> sans compression. **Le reste — l'application — est compressible ; il est ici
> déjà fait.**

### 16.3 Priorités techniques recommandées

Classées par rapport valeur/coût, en cohérence avec la règle d'arbitrage :

1. **Lancer les demandes d'accès aux datasets** — coût nul, délai incompressible.
   Rien d'autre ne devrait passer avant.
2. **Rendre les URLs présignées utilisables depuis le navigateur** — dissocier
   endpoint interne et endpoint public de signature. Débloque la démonstration
   visuelle, donc la soutenance.
3. **Routes et UI de revue praticien** — ferme CU-03 et transforme le PDF en
   document validé.
4. **Alimenter `model_versions` et construire la page de performance** — ferme
   CU-06, le parcours du jury.
5. **Test d'intégration bout-en-bout** — le mock étant déterministe, le coût est
   faible et la régression couverte est large.
6. **Entraîner et publier un modèle** — l'outillage est en place
   ([`training/`](../training/)) ; il n'attend que les données. La numérotation
   FDI et le seuil de confiance sont déjà faits.

---

## 17. Livrables

| Livrable PRD §16 | État |
|---|---|
| Application web (frontend React + backend FastAPI) : import, inférence, revue, rapport PDF | ⚠️ **tout sauf la revue** |
| Service d'inférence IA (YOLOv11 / PyTorch) et poids versionnés | ✅ registre de versions, poids vérifiés par empreinte, bascule sans redéploiement |
| Pipeline de données documenté (préparation, découpage sans fuite, entraînement) | ⚠️ **écrit** ([`training/`](../training/) + [README](../training/README.md)), jamais exécuté |
| Rapport d'évaluation chiffré (métriques par classe, matrice de confusion, analyse des échecs) | 🔬 à produire |
| Documentation technique et guide d'utilisation | ✅ ce document, [README.md](../README.md), [architecture.md](architecture.md), [frontend/README.md](../frontend/README.md) |
| Mémoire, rédigé au fil de l'eau | 🔬 en cours |

---

## 18. Matrice de traçabilité PRD → code

Vue de synthèse. Chaque ligne renvoie à la section détaillée.

| PRD | Exigence | État | Preuve dans le code | § |
|---|---|---|---|---|
| §3 | Import DICOM / JPG / PNG | ✅ | `services/anonymize.py` | 5.1 |
| §3 / §9.1 | Anonymisation avant tout stockage | ✅ | 13 tags + ré-encodage PNG, testé | 5.1 |
| §3 / §5.2 | Numérotation FDI | ✅ | `inference/app/fdi.py`, `backend/app/services/numerotation.py`, schéma `views/analyse` ; parcours `e2e/parcours-numerotation.spec.js` | 5.2, 10.7 |
| §3 / §5.2 | 4 classes d'anomalies | ⚠️ | `inference/app/config.py` | 1.3 |
| §3 / §5.2 | Seuil de décision paramétrable | ⚠️ | `MODEL_CONF_THRESHOLD`, service seulement | 5.2 |
| §3 | Affichage superposé des détections | ✅ | `widgets/detection-viewer` | 4 |
| §3 / §5.3 | Correction / validation manuelle | ❌ | colonnes `reviewed`, `source` seules | 5.3 |
| §3 / §5.4 | Rapport PDF annoté et anonymisé | ✅ | `services/report.py` | 5.4 |
| §3 | Tableau de bord : historique | ⚠️ | `GET /api/analyses` sans UI | 4 |
| §3 / §5.5 | Page de performance du modèle | ❌ | `model_versions` vide | 5.5 |
| §3 | Pipeline scientifique documenté | ⚠️ | `training/`, jamais exécuté | 10 |
| §7.1 | Frontend React | ✅ | Next.js 14 / FSD | 9 |
| §7.1 | Backend FastAPI orchestrateur | ✅ | `backend/app` | 8.1 |
| §7.1 | Service d'inférence **isolé** | ✅ | contrat HTTP, aucun accès base/stockage | 7.2 |
| §7.1 | PostgreSQL sans donnée identifiante | ✅ | `models.py` | 8.3 |
| §7.1 | Stockage objet chiffré au repos | ⚠️ | MinIO ✅, chiffrement ❌ | 11.1 |
| §7.1 | Journalisation / audit | ❌ | — | 11.1 |
| §7.3 | Version de modèle par analyse | ✅ | `analyses.model_version` | 7.5 |
| §7.3 | Version de dataset par analyse | ❌ | `model_versions` vide | 7.5 |
| §7.3 | Corrections horodatées conservées | ❌ | — | 7.5 |
| §8.1 | Stratégie de données DENTEX / UFBA / Tufts | 🔬 | — | 10.1 |
| §8.2 | YOLOv11 sous PyTorch | ✅ | YOLO11s, deux modèles (dents, anomalies) | 10.6 |
| §8.3 | Découpage sans fuite, test gelé, métriques par classe | 🔬 | — | 10.3 |
| §9.1 | Chiffrement en transit (HTTPS) | ❌ | HTTP local | 11.1 |
| §9.1 | Contrôle d'accès (JWT) | ❌ | `python-jose` provisionné, inutilisé | 11.1 |
| §9.2 | Minimisation RGPD | ✅ | par conception du schéma | 11.2 |
| §9.3 | Mentions prototype sur UI et rapports | ✅ | en-tête, vitrine, pied de PDF | 11.3 |
| §9.3 | Aucun diagnostic affirmatif | ✅ | vocabulaire de signalement | 2 |
| §10 | Fiabilité : aucune analyse perdue, erreurs rejouables | ❌ | `500` sans persistance | 12 |
| §10 | Reproductibilité | ⚠️ | mock déterministe ✅, entraînement ❌ | 12 |
| §10 | Responsive desktop + mobile | ✅ | Tailwind | 12 |
| §10 | Maintenabilité : service IA remplaçable | ✅ | contrat `POST /infer` | 8.2 |
| §11 | Docker | ✅ | Compose + override GPU | 13.1 |
| §11 | GitHub Actions | ✅ | 3 jobs | 13.3 |
| §11 | Suivi des expériences | ❌ | — | 12 |
| §11 | n8n / OpenAI / Supabase retirés | ✅ | aucune trace dans le code | 3.2 |
| §12 | Séparation entraînement / service | ✅ | poids montés en lecture seule | 13.5 |
| §12 | Trois environnements | ⚠️ | local CPU/GPU ✅, préproduction ❌ | 13.1 |
| §12 | Jeu de démonstration préparé | 🔬 | à constituer | 13.1 |

**Décompte sur 39 exigences tracées** : 18 ✅ · 7 ⚠️ · 10 ❌ · 4 🔬.
Les ✅ se concentrent sur l'**infrastructure et la conformité formelle** ; les ❌
et 🔬, sur la **science et la revue clinique**.

---

## 19. Glossaire

| Terme | Définition |
|---|---|
| **Bbox** (boîte englobante) | Rectangle délimitant un objet détecté. Ici `[x, y, largeur, hauteur]` en pixels |
| **CBCT** | *Cone Beam Computed Tomography* — imagerie dentaire 3D. Hors périmètre |
| **DENTEX** | Jeu de données public de panoramiques annotées (quadrant → numérotation → diagnostic), socle central prévu du projet |
| **DICOM** | *Digital Imaging and Communications in Medicine* — format standard d'imagerie médicale, porteur de métadonnées patient à anonymiser |
| **FDI** | Système international de numérotation dentaire à deux chiffres : quadrant (1–4) puis position (1–8). « 36 » = première molaire mandibulaire gauche |
| **FSD** (Feature-Sliced Design) | Architecture frontend en couches où les imports vont toujours vers le bas. Voir §9.2 |
| **mAP@0.5** | *mean Average Precision* à un seuil d'IoU de 0,5 — métrique standard de détection d'objets |
| **mAP@0.5:0.95** | Moyenne de la mAP sur des seuils d'IoU de 0,5 à 0,95 — plus exigeante sur la précision de localisation |
| **MDR** | *Medical Device Regulation* — règlement européen 2017/745 sur les dispositifs médicaux |
| **Mode mock** | Mode dégradé du service d'inférence renvoyant des détections factices déterministes, en l'absence de poids de modèle. Voir §10.4 |
| **Panoramique** (orthopantomogramme) | Radiographie couvrant l'ensemble des arcades dentaires en une image |
| **Sensibilité / spécificité** | Taux de vrais positifs / vrais négatifs. En dépistage, une faible sensibilité signifie des lésions manquées — coûteuses cliniquement |
| **URL présignée** | Lien temporaire signé donnant accès à un objet du stockage S3 sans identifiants. Ici valable 1 h |
| **YOLO** | *You Only Look Once* — famille de détecteurs d'objets en une passe. YOLOv11 est le modèle retenu |

---

## 20. Où lire quoi

| Besoin | Document |
|---|---|
| Démarrer la stack, ports, variables, dépannage, commandes | [README.md](../README.md) |
| Vue d'architecture en une page | [docs/architecture.md](architecture.md) |
| Couches FSD, design system, animations, conventions du client | [frontend/README.md](../frontend/README.md) |
| Contrat d'API interactif | http://localhost:8000/docs (Swagger généré) |
| Catalogue des composants d'interface | http://localhost:3000/design-system |
| Périmètre, exigences, méthodologie de validation, cadre réglementaire | **ce document** + PRD v1.0 |

### Points d'entrée du code

| Sujet | Fichier |
|---|---|
| Anonymisation | [`backend/app/services/anonymize.py`](../backend/app/services/anonymize.py) |
| Orchestration d'une analyse | [`backend/app/routers/analyses.py`](../backend/app/routers/analyses.py) |
| Génération du PDF | [`backend/app/services/report.py`](../backend/app/services/report.py) |
| Schéma de base | [`backend/app/models.py`](../backend/app/models.py) |
| Chargement du modèle et mode mock | [`inference/app/model.py`](../inference/app/model.py) |
| Classes du périmètre | [`inference/app/config.py`](../inference/app/config.py) |
| Rendu des détections | [`frontend/src/widgets/detection-viewer/lib/draw-detections.js`](../frontend/src/widgets/detection-viewer/lib/draw-detections.js) |
| Modèle métier des détections | [`frontend/src/entities/detection/model/detection.js`](../frontend/src/entities/detection/model/detection.js) |

---

*PanoraDent AI est un prototype de recherche. Il ne constitue pas un dispositif
médical certifié et ne remplace pas le jugement d'un professionnel de santé.*

*Documentation établie le 26 août 2026, sur la base du PRD v1.0 (30/07/2026) et
du dépôt à `main` @ `ab5df04`.*
