from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # pydantic-settings lit automatiquement les variables d'environnement
    # correspondantes (insensible à la casse) : DATABASE_URL, S3_ENDPOINT, etc.
    database_url: str = "postgresql+psycopg2://panoradent:panoradent@db:5432/panoradent"
    s3_endpoint: str = "http://minio:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "panoradent"
    inference_url: str = "http://inference:8001"
    jwt_secret: str = "change-me-in-prod"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
