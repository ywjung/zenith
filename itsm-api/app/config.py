from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    DATABASE_URL: str = "postgresql+psycopg://itsm:change_me@postgres:5432/itsm"

    # GitLab
    GITLAB_API_URL: str = "http://gitlab:80"
    GITLAB_ADMIN_TOKEN: str = ""
    GITLAB_PROJECT_ID: str = "1"

    # App
    ENVIRONMENT: str = "production"
    CORS_ORIGINS: str = "http://localhost"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]


@lru_cache
def get_settings() -> Settings:
    return Settings()
