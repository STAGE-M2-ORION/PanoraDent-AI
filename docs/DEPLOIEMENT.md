# Déployer PanoraDent AI au cabinet

Ce guide installe PanoraDent AI sur le serveur d'un cabinet dentaire, de la
machine nue jusqu'à la première analyse. Il s'adresse à la personne qui fait
l'installation, sans aide extérieure : un technicien qui sait ouvrir un
terminal Linux et éditer un fichier.

> ⚠️ **Prototype de recherche, non certifié dispositif médical.** Les
> détections sont des propositions ; la décision médicale revient au praticien.

Durée prévue : environ une heure. Les étapes 2 et 3 sont les plus longues, à
cause des téléchargements. La suite (exploitation au quotidien, sauvegardes,
incidents) est dans le [guide d'exploitation](EXPLOITATION.md).

---

## 0. À réunir avant de commencer

| Quoi | Pourquoi | Auprès de qui |
|---|---|---|
| Un serveur sur le réseau du cabinet (voir § 1) | Tout tourne dessus ; rien ne sort du cabinet | Le cabinet |
| Un **nom** pour le serveur, ex. `panoradent.cabinet.lan` | Les postes l'ouvrent dans le navigateur, le certificat HTTPS est émis pour ce nom | L'administrateur du réseau (DNS) ou vous (fichier `hosts`) |
| Un **client OAuth Google** (identifiant et secret) | Connexion « Continuer avec Google » ; obligatoire en production | La personne qui gère le compte Google du cabinet |
| Un **compte d'envoi d'e-mails** (serveur SMTP, port, identifiant, mot de passe) | Liens de première connexion et de mot de passe oublié ; obligatoire en production | Le fournisseur de messagerie du cabinet |
| L'**adresse e-mail Google de l'administrateur** | Le premier compte ; en production, il entre par Google | Le cabinet |
| Le **paquet modèle** (dossier `dentex-2026.11/` : `dents.pt`, `anomalies.pt`, `publication.json`) | Les poids du modèle ne sont pas dans le dépôt | L'équipe qui a entraîné le modèle (`make modele-exporter`) |
| Un **disque de sauvegarde** (autre disque, NAS) | Les sauvegardes ne doivent pas vivre sur le même disque | Le cabinet |

---

## 1. Le serveur

| | Minimum | Recommandé |
|---|---|---|
| Système | Linux 64 bits (Ubuntu Server 24.04 LTS ou Debian 12) | idem |
| Processeur | 4 cœurs x86-64 | 8 cœurs |
| Mémoire | 8 Go (sans l'assistant documentaire) | 16 Go (avec l'assistant) |
| Disque | 40 Go libres | 100 Go, SSD |
| Réseau | adresse IP fixe sur le réseau local | idem |
| Carte graphique | aucune | NVIDIA, facultative (§ 9) |

Repères mesurés sur la pile en marche : chaque service applicatif consomme
moins de 250 Mo au repos ; l'assistant (Ollama) 0,8 Go au repos et plusieurs
Go pendant une réponse. Les images Docker pèsent environ 12 Go, les modèles
de l'assistant 2,9 Go ; les données (radiographies anonymisées, comptes
rendus) s'ajoutent ensuite.

**Ports** : seuls **80** et **443** sont ouverts, sur le réseau local
uniquement. Ne publiez jamais le serveur sur Internet.

---

## 2. Installer Docker et récupérer PanoraDent

1. Installez **Docker Engine** et le greffon **Compose v2** en suivant la
   documentation officielle de Docker pour votre distribution
   (« Install Docker Engine on Ubuntu »). Vérifiez :

   ```bash
   docker --version            # Docker 24 ou plus récent
   docker compose version      # v2.x
   ```

2. Récupérez le code dans `/opt/panoradent` :

   ```bash
   sudo git clone <adresse du dépôt> /opt/panoradent
   cd /opt/panoradent
   ```

3. Pour toute la suite, dans chaque terminal ouvert sur le serveur :

   ```bash
   cd /opt/panoradent
   export COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
   ```

   Les scripts (`scripts/*.sh`) et les commandes de ce guide utilisent cette
   variable : sans elle, ils viseraient la configuration de développement.

---

## 3. Nommer le serveur

Les postes doivent joindre le serveur par son nom, pas par son adresse IP :
le certificat HTTPS est émis pour ce nom.

- **Avec un DNS au cabinet** (box, routeur, serveur Windows) : créez un
  enregistrement A `panoradent.cabinet.lan` → adresse IP du serveur.
- **Sans DNS** : ajoutez sur **chaque poste** la ligne
  `192.168.1.20  panoradent.cabinet.lan` (votre adresse) au fichier `hosts`
  (Windows : `C:\Windows\System32\drivers\etc\hosts`, en administrateur ;
  macOS / Linux : `/etc/hosts`).

Vérifiez depuis un poste : `ping panoradent.cabinet.lan` répond par l'adresse
du serveur.

---

## 4. Le fichier de configuration `.env`

```bash
cp .env.example .env
chmod 600 .env          # lisible par root seulement : il contient les secrets
```

Ouvrez `.env` et renseignez **au moins** ces valeurs (remplacez
`panoradent.cabinet.lan` par votre nom) :

| Variable | Valeur |
|---|---|
| `APP_ENV` | `production` |
| `PANORADENT_HOTE` | `panoradent.cabinet.lan` |
| `APP_URL` | `https://panoradent.cabinet.lan` |
| `GOOGLE_REDIRECT_URI` | `https://panoradent.cabinet.lan/api/v1/auth/google/retour` |
| `ALLOWED_ORIGINS` | `["https://panoradent.cabinet.lan"]` (avec les crochets et les guillemets) |
| `JWT_SECRET` | un secret aléatoire (commande ci-dessous) |
| `POSTGRES_PASSWORD` | un secret aléatoire |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | un identifiant et un secret aléatoires (stockage des images) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ceux du client OAuth (§ 5) |
| `ADMIN_EMAIL` | l'adresse Google de l'administrateur |
| `COURRIEL_MODE` | `smtp` |
| `COURRIEL_EXPEDITEUR` | ex. `PanoraDent <panoradent@cabinet.fr>` |
| `SMTP_HOTE`, `SMTP_PORT`, `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE` | ceux du compte d'envoi |

Pour chaque secret aléatoire, une valeur différente :

```bash
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48
```

Les autres variables gardent leur valeur par défaut (liste complète :
[README, Variables d'environnement](../README.md#variables-denvironnement)).
Les limites de débit (`LIMITE_*_MINUTE`) ne peuvent pas valoir 0 en
production.

**Le serveur vérifie lui-même sa configuration** : en production, le backend
refuse de démarrer si un secret manque, est trop court ou vaut la valeur
d'exemple, si Google ou l'envoi d'e-mails n'est pas configuré. Le message
d'erreur nomme la variable fautive (§ 10).

> **Gardez une copie du `.env`** hors du serveur (coffre-fort de mots de
> passe, clé chiffrée) : les sauvegardes ne le contiennent pas, et sans lui
> les données restaurées sont inutilisables.

---

## 5. Le client Google

Dans la [console Google Cloud](https://console.cloud.google.com/), avec le
compte Google du cabinet :

1. *API et services › Écran de consentement OAuth* : type **Interne** si le
   cabinet a un Google Workspace, sinon **Externe** ; portées `openid`,
   `email`, `profile`. En mode « Test », ajoutez les adresses des
   utilisateurs comme *utilisateurs de test*.
2. *API et services › Identifiants › Créer des identifiants › ID client
   OAuth*, type **Application Web**. Dans **URI de redirection autorisés**,
   exactement : `https://panoradent.cabinet.lan/api/v1/auth/google/retour`.
   Aucune « origine JavaScript » n'est nécessaire.
3. Copiez l'identifiant et le secret dans `GOOGLE_CLIENT_ID` et
   `GOOGLE_CLIENT_SECRET` du `.env`.

Détails : [README, Authentification et rôles](../README.md#authentification-et-rôles).

---

## 6. Démarrer

```bash
$COMPOSE up -d --build
```

La première fois, la construction et les téléchargements prennent plusieurs
minutes ; ensuite, le démarrage prend une trentaine de secondes. Les
migrations de la base sont appliquées automatiquement.

```bash
$COMPOSE ps
```

Tous les services doivent être `Up`, **sauf `inference`**, qui redémarre en
boucle tant qu'aucun modèle n'est installé : c'est voulu. En production, il
refuse de servir des détections factices. L'étape suivante le corrige.

---

## 7. Installer le modèle

Copiez le paquet modèle sur le serveur (clé USB, partage réseau), par exemple
dans `/opt/panoradent-paquets/dentex-2026.11/`, puis :

```bash
scripts/modele.sh installer /opt/panoradent-paquets/dentex-2026.11
```

Le script vérifie que les poids sont bien ceux de la fiche (empreintes
SHA-256) **avant** toute copie, les dépose dans `inference/weights/`, inscrit
la version au registre (non active) et redémarre le service d'inférence.
`$COMPOSE ps` montre alors `inference` en `Up (healthy)`.

La version sera **activée** par l'administrateur à l'étape 9.

---

## 8. Le certificat HTTPS sur les postes

Caddy émet le certificat du site avec sa propre autorité, sans rien demander
à Internet. Chaque poste doit faire confiance à cette autorité, **une fois** :

```bash
$COMPOSE cp caddy:/data/caddy/pki/authorities/local/root.crt panoradent-racine.crt
```

Copiez `panoradent-racine.crt` sur chaque poste, puis :

- **Windows** : double-clic › *Installer le certificat* › *Ordinateur local* ›
  *Placer tous les certificats dans le magasin suivant* › **Autorités de
  certification racines de confiance**. Redémarrez le navigateur.
- **macOS** : double-clic › Trousseau **Système** › ouvrir le certificat ›
  *Se fier* › **Toujours approuver**.

Cette autorité vit dans le volume `caddy_data`, que les sauvegardes
emportent. Si elle était perdue, il faudrait réinstaller un nouveau
certificat sur tous les postes.

---

## 9. Premier accès et mise en route

1. Depuis un poste, ouvrez `https://panoradent.cabinet.lan` : la page de
   connexion s'affiche, **sans avertissement de sécurité** (sinon, § 8).
2. **Continuer avec Google** avec l'adresse `ADMIN_EMAIL`. En production,
   aucun lien de première connexion n'est imprimé dans les journaux :
   l'administrateur entre par Google, puis peut choisir un mot de passe dans
   son profil (utile si Internet tombe).
3. **Administration › Modèles** : activez `dentex-2026.11` avec un motif
   (« installation initiale »). Le service d'inférence charge la version et
   vérifie ses empreintes avant qu'elle devienne active.
4. **Administration › Cabinet** : nom, adresse, mentions, logo (en-tête des
   comptes rendus).
5. **Administration › Comptes** : créez les comptes (praticiens, lecteurs).
   Chacun reçoit son lien par e-mail. Le mot de passe n'est jamais choisi par
   l'administrateur.
6. **Administration › Supervision** : tous les services au vert.

**Ne lancez pas `make demo` en production** : il est refusé, et des comptes ou
des analyses fictifs n'ont rien à faire dans le dossier du cabinet.

---

## 10. Vérifier l'installation

Depuis le serveur :

```bash
bash scripts/verifier-https.sh http://panoradent.cabinet.lan https://panoradent.cabinet.lan
curl -sk https://panoradent.cabinet.lan/api/v1/health
```

Le premier doit finir par `HTTPS conforme.` (redirection, en-têtes de
sécurité, certificat de l'autorité interne). Le second doit répondre
`"statut":"ok"` avec les quatre services à `ok`.

Puis la **recette d'installation**, à cocher :

- [ ] La page de connexion s'ouvre sans avertissement sur chaque poste.
- [ ] L'administrateur se connecte avec Google.
- [ ] La version du modèle est active (Administration › Modèles).
- [ ] Un praticien reçoit son e-mail de première connexion et choisit son mot de passe.
- [ ] Le praticien importe une panoramique : l'analyse passe « Terminée » en moins d'une minute.
- [ ] Le compte rendu PDF se télécharge, avec le logo du cabinet.
- [ ] Une première sauvegarde réussit (§ 11) et apparaît sur le disque de sauvegarde.

---

## 11. Sauvegardes automatiques

Montez le disque de sauvegarde (ex. `/mnt/sauvegardes`), puis programmez une
sauvegarde chaque nuit (`sudo crontab -e`) :

```cron
0 2 * * * cd /opt/panoradent && COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml" scripts/sauvegarder.sh /mnt/sauvegardes >> /var/log/panoradent-sauvegarde.log 2>&1
```

Les 14 dernières sont gardées (`GARDER=N` pour changer). Faites une première
sauvegarde à la main tout de suite, et notez sa taille et sa durée :

```bash
scripts/sauvegarder.sh /mnt/sauvegardes
```

Restauration, rotation, copie hors site : [guide d'exploitation](EXPLOITATION.md#sauvegardes-et-restauration).

---

## 12. Assistant documentaire (facultatif)

L'assistant répond aux questions du praticien à partir des documents de
référence du cabinet. Les modèles tournent sur le serveur, rien ne sort.

```bash
$COMPOSE --profile assistant up -d
$COMPOSE exec ollama ollama pull bge-m3       # ~1,2 Go
$COMPOSE exec ollama ollama pull qwen2.5:3b   # ~2 Go
```

Ensuite, **Administration › Base documentaire** : déposez les documents (PDF ou
Markdown). Ajoutez `--profile assistant` à chaque `$COMPOSE up` suivant.

---

## 13. Carte graphique NVIDIA (facultatif)

Avec le NVIDIA Container Toolkit installé :

```bash
$COMPOSE -f docker-compose.gpu.yml up -d --build
```

Sur processeur, une analyse prend quelques secondes : la carte graphique
n'est utile qu'à fort volume.

---

## 14. En cas de problème à l'installation

| Symptôme | Cause probable | Que faire |
|---|---|---|
| `backend` redémarre en boucle | Configuration refusée | `$COMPOSE logs backend \| tail -20` : le message nomme la variable (secret trop court, SMTP absent…). Corrigez `.env`, puis `$COMPOSE up -d` |
| `inference` redémarre en boucle | Aucun modèle installé | § 7. `$COMPOSE logs inference \| tail` dit « aucune version publiée » |
| Avertissement de certificat dans le navigateur | Autorité non installée, ou nom différent de `PANORADENT_HOTE` | § 8 ; ouvrez le site par **le nom**, pas par l'adresse IP |
| Google : « redirect_uri_mismatch » | URI déclarée différente de `GOOGLE_REDIRECT_URI` | § 5 : même valeur, au caractère près (https, pas de `/` final) |
| Google : « Accès bloqué » | Écran de consentement en mode Test | Ajoutez l'adresse aux utilisateurs de test (§ 5) |
| Connexion Google refusée : « compte inconnu » | Aucun compte PanoraDent pour cette adresse | L'administrateur crée le compte (§ 9) ; pour lui-même, vérifiez `ADMIN_EMAIL` |
| E-mails non reçus | SMTP refusé | `$COMPOSE logs backend \| grep -i smtp` ; vérifiez hôte, port, identifiants, STARTTLS |
| Analyses « Échouée » : aucune version active | Modèle installé mais pas activé | Administration › Modèles › Activer |
| « Trop de demandes » à la connexion | Limite par poste (10 par minute) | Attendre la minute indiquée ; si cela se répète, voir le journal d'audit |

D'autres situations, une fois la plateforme en service : [guide
d'exploitation, Incidents](EXPLOITATION.md#incidents).
