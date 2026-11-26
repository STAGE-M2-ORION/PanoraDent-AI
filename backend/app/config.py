from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "change-me-in-prod"

# Environnements reconnus. `test` est le seul qui autorise le fournisseur
# d'identité de remplacement (voir `identity.py`).
ENVIRONNEMENTS = {"development", "test", "production"}
FOURNISSEURS = {"google", "fake"}
MODES_COURRIEL = {"console", "memoire", "smtp"}
FOURNISSEURS_ASSISTANT = {"ollama", "factice"}


class Settings(BaseSettings):
    # pydantic-settings lit automatiquement les variables d'environnement
    # correspondantes (insensible à la casse) : DATABASE_URL, S3_ENDPOINT, etc.
    database_url: str = "postgresql+psycopg2://panoradent:panoradent@db:5432/panoradent"
    s3_endpoint: str = "http://minio:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "panoradent"
    # Origine publique des URLs présignées (ex. « /storage » derrière le proxy
    # nginx du frontend). Vide : l'URL garde l'origine interne `s3_endpoint`,
    # que le navigateur ne sait pas résoudre en Docker.
    s3_public_url: str = ""
    inference_url: str = "http://inference:8001"
    # Fuseau du cabinet : heures affichées sur le compte rendu (la base est en UTC).
    fuseau_horaire: str = "Indian/Antananarivo"

    # --- Session -----------------------------------------------------------
    # `development` tolère le secret par défaut ; `production` le refuse.
    app_env: str = "development"
    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    # Attribut `Secure` des cookies. Les navigateurs l'acceptent sur
    # http://localhost ; ne le désactiver que pour un accès HTTP par IP.
    cookie_secure: bool = True
    # Origines autorisées pour le CORS. Variable d'environnement au format
    # JSON : ALLOWED_ORIGINS='["http://localhost:3000"]'.
    allowed_origins: list[str] = ["http://localhost:3000"]

    # --- Connexion Google (OAuth 2.0 + OpenID Connect) ---------------------
    # `google` en temps normal ; `fake` = fournisseur de remplacement pour les
    # tests automatisés, refusé hors APP_ENV=test.
    identity_provider: str = "google"
    google_client_id: str = ""
    # Ne vit que dans l'environnement du serveur : jamais dans le dépôt ni
    # dans le code de l'interface.
    google_client_secret: str = ""
    # Doit figurer EXACTEMENT dans la console Google (une URI par
    # environnement). Passe par le proxy nginx du frontend : les cookies sont
    # ainsi posés sur l'origine de l'application.
    google_redirect_uri: str = "http://localhost:3000/api/v1/auth/google/retour"
    # Origine de l'interface : destination après connexion et en cas d'échec.
    app_url: str = "http://localhost:3000"
    # Domaine Google Workspace autorisé (ex. « cabinet.fr »). Vide : toute
    # adresse Google dont un compte existe peut se connecter.
    google_allowed_domain: str = ""

    # --- Mots de passe -----------------------------------------------------
    # Coût bcrypt : 12 en service. Les tests le baissent (BCRYPT_COUT=4) pour
    # rester rapides ; la production refuse moins de 12.
    bcrypt_cout: int = 12
    # Verrouillage temporaire après N échecs consécutifs.
    echecs_avant_verrouillage: int = 5
    duree_verrouillage_minutes: int = 15
    # Limitation de débit, par adresse du poste et par minute (0 : désactivée).
    # Connexion et liens reçus par e-mail ; mot de passe oublié ; toute l'API.
    limite_connexion_minute: int = 10
    limite_oubli_minute: int = 5
    limite_api_minute: int = 600

    # --- E-mails de notification (sprint 13) ---------------------------------
    # Délai de grâce : lue dans l'application avant, la notification ne part
    # pas par e-mail. Intervalle : au plus un e-mail par destinataire.
    notif_courriel_grace_s: int = Field(default=120, ge=0)
    notif_courriel_intervalle_s: int = Field(default=300, ge=0)

    # --- E-mails -----------------------------------------------------------
    # `console` : affichés dans les journaux du conteneur (développement) ;
    # `memoire` : gardés en mémoire (tests) ; `smtp` : réellement envoyés.
    courriel_mode: str = "console"
    courriel_expediteur: str = "PanoraDent AI <no-reply@panoradent.local>"
    smtp_hote: str = ""
    smtp_port: int = 587
    smtp_utilisateur: str = ""
    # Ne vit que dans l'environnement du serveur, jamais dans le dépôt.
    smtp_mot_de_passe: str = ""
    # STARTTLS sur le port 587 ; mettre false uniquement pour un relais local.
    smtp_starttls: bool = True

    # --- Stockage des radiographies ---------------------------------------
    # Alerte d'administration au-delà de ce volume occupé dans le stockage objet.
    stockage_alerte_go: float = 50.0

    # --- Assistant documentaire (sprint 9) ----------------------------------
    # `ollama` : modèles locaux servis par le conteneur Ollama, rien ne sort du
    # cabinet ; `factice` : vecteurs et réponses calculés sans modèle (tests,
    # parcours e2e), refusé quand APP_ENV=production.
    assistant_fournisseur: str = "ollama"
    ollama_url: str = "http://ollama:11434"
    # Modèle de vectorisation : sa dimension doit valoir celle de la colonne
    # `passages.vecteur` (1024 pour bge-m3).
    modele_vecteurs: str = "bge-m3"
    modele_langage: str = "qwen2.5:3b"
    # Recherche : passages remis au modèle, et similarité cosinus minimale. Sous
    # ce seuil, un passage n'est pas jugé pertinent ; si aucun ne le passe,
    # l'assistant refuse de répondre plutôt que de compléter de mémoire.
    assistant_passages: int = 5
    assistant_seuil: float = 0.5
    # Rédacteur factice : secondes entre deux mots livrés au fil de l'eau
    # (les parcours e2e le ralentissent pour pouvoir l'arrêter).
    assistant_delai_factice: float = 0.02

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def _verifier_coherence(self):
        env = self.app_env.lower()
        if env not in ENVIRONNEMENTS:
            raise ValueError(f"APP_ENV inconnu : {self.app_env!r} ({', '.join(sorted(ENVIRONNEMENTS))}).")
        provider = self.identity_provider.lower()
        if provider not in FOURNISSEURS:
            raise ValueError(f"IDENTITY_PROVIDER inconnu : {self.identity_provider!r}.")
        if provider == "fake" and env != "test":
            raise ValueError(
                "IDENTITY_PROVIDER=fake n'est autorisé qu'avec APP_ENV=test : "
                "le fournisseur de remplacement laisserait entrer n'importe qui."
            )
        mode = self.courriel_mode.lower()
        if mode not in MODES_COURRIEL:
            raise ValueError(f"COURRIEL_MODE inconnu : {self.courriel_mode!r} ({', '.join(sorted(MODES_COURRIEL))}).")
        if mode == "memoire" and env != "test":
            raise ValueError("COURRIEL_MODE=memoire n'est autorisé qu'avec APP_ENV=test.")
        if mode == "smtp" and not self.smtp_hote:
            raise ValueError("SMTP_HOTE est obligatoire quand COURRIEL_MODE=smtp.")
        assistant = self.assistant_fournisseur.lower()
        if assistant not in FOURNISSEURS_ASSISTANT:
            raise ValueError(f"ASSISTANT_FOURNISSEUR inconnu : {self.assistant_fournisseur!r}.")
        if env == "production":
            if assistant == "factice":
                raise ValueError("ASSISTANT_FOURNISSEUR=factice est refusé quand APP_ENV=production.")
            if self.bcrypt_cout < 12:
                raise ValueError("BCRYPT_COUT doit valoir au moins 12 quand APP_ENV=production.")
            if min(self.limite_connexion_minute, self.limite_oubli_minute, self.limite_api_minute) <= 0:
                raise ValueError("La limitation de débit (LIMITE_*_MINUTE) ne peut pas être coupée quand APP_ENV=production.")
            if mode != "smtp":
                raise ValueError(
                    "COURRIEL_MODE=smtp est obligatoire quand APP_ENV=production : "
                    "les liens de première connexion et de réinitialisation partent par e-mail."
                )
            if self.jwt_secret == DEFAULT_JWT_SECRET or len(self.jwt_secret) < 32:
                raise ValueError(
                    "JWT_SECRET doit être défini (32 caractères minimum, aléatoire) "
                    "quand APP_ENV=production."
                )
            if not self.google_client_id or not self.google_client_secret:
                raise ValueError(
                    "GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sont obligatoires "
                    "quand APP_ENV=production."
                )
        return self

    @property
    def fournisseur_factice(self) -> bool:
        return self.identity_provider.lower() == "fake"


settings = Settings()
