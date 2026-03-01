from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    DATABASE_URL: str = "postgresql+psycopg://itsm:change_me@postgres:5432/itsm"

    # GitLab
    GITLAB_API_URL: str = "http://gitlab:80"          # 컨테이너 내부 통신용
    GITLAB_EXTERNAL_URL: str = "http://localhost:8929"  # 브라우저 리다이렉트용
    GITLAB_ADMIN_TOKEN: str = ""
    GITLAB_PROJECT_ID: str = "1"
    GITLAB_OAUTH_CLIENT_ID: str = ""
    GITLAB_OAUTH_CLIENT_SECRET: str = ""
    GITLAB_OAUTH_REDIRECT_URI: str = "http://localhost/api/auth/callback"

    # App
    SECRET_KEY: str = "change_me_to_random_32char_string"
    ENVIRONMENT: str = "production"
    CORS_ORIGINS: str = "http://localhost"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]


@lru_cache
def get_settings() -> Settings:
    return Settings()
