from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "change-me-in-prod"


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

    # --- Authentification -------------------------------------------------
    # `development` tolère le secret par défaut ; `production` le refuse au
    # démarrage (voir `_check_production_secret`).
    app_env: str = "development"
    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    # Coût bcrypt. 12 est un défaut raisonnable ; les tests le baissent.
    bcrypt_rounds: int = 12
    # Origines autorisées pour le CORS. Variable d'environnement au format
    # JSON : ALLOWED_ORIGINS='["http://localhost:3000"]'.
    allowed_origins: list[str] = ["http://localhost:3000"]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def _check_production_secret(self):
        if self.app_env.lower() == "production":
            if self.jwt_secret == DEFAULT_JWT_SECRET or len(self.jwt_secret) < 32:
                raise ValueError(
                    "JWT_SECRET doit être défini (32 caractères minimum, aléatoire) "
                    "quand APP_ENV=production."
                )
        return self


settings = Settings()
