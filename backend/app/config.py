from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "change-me-in-prod"

# Environnements reconnus. `test` est le seul qui autorise le fournisseur
# d'identité de remplacement (voir `identity.py`).
ENVIRONNEMENTS = {"development", "test", "production"}
FOURNISSEURS = {"google", "fake"}
MODES_COURRIEL = {"console", "memoire", "smtp"}


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
        if env == "production":
            if self.bcrypt_cout < 12:
                raise ValueError("BCRYPT_COUT doit valoir au moins 12 quand APP_ENV=production.")
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
