import logging
from functools import lru_cache

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    DATABASE_URL: str = "postgresql+psycopg://itsm:change_me@postgres:5432/itsm"

    # GitLab
    GITLAB_API_URL: str = "http://gitlab:80"          # 컨테이너 내부 통신용
    GITLAB_EXTERNAL_URL: str = "http://localhost:8929"  # 브라우저 리다이렉트용
    GITLAB_PROJECT_TOKEN: str = ""  # 프로젝트 레벨 액세스 토큰 (api scope)
    GITLAB_GROUP_ID: str = ""       # 공용 라벨을 관리할 그룹 ID
    GITLAB_GROUP_TOKEN: str = ""    # 그룹 레벨 액세스 토큰 (api scope)
    GITLAB_PROJECT_ID: str = "1"
    GITLAB_OAUTH_CLIENT_ID: str = ""
    GITLAB_OAUTH_CLIENT_SECRET: str = ""
    GITLAB_OAUTH_REDIRECT_URI: str = "http://localhost/api/auth/callback"
    GITLAB_WEBHOOK_SECRET: str = ""
    # GitLab이 ITSM으로 이벤트를 보낼 웹훅 URL (개발 프로젝트 전달 실시간 동기화용)
    # Docker 내부: http://itsm-api:8000/webhooks/gitlab
    ITSM_WEBHOOK_URL: str = ""
    # ITSM 서비스 계정 GitLab username — 웹훅 루프 방지용 (설정 안 하면 봇 필터 비적용)
    GITLAB_BOT_USERNAME: str = ""

    # App
    SECRET_KEY: str = "change_me_to_random_32char_string"
    # Fernet key for refresh token encryption
    # Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    TOKEN_ENCRYPTION_KEY: str = ""
    ENVIRONMENT: str = "production"
    CORS_ORIGINS: str = "http://localhost"

    # Redis
    REDIS_URL: str = "redis://redis:6379"

    # SMTP / Notifications
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "ITSM Portal <noreply@company.com>"
    SMTP_TLS: bool = True
    NOTIFICATION_ENABLED: bool = False
    IT_TEAM_EMAIL: str = ""

    # Telegram
    TELEGRAM_ENABLED: bool = False
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""  # IT팀 그룹 채팅 ID

    # IMAP email ingest
    IMAP_ENABLED: bool = False
    IMAP_HOST: str = ""
    IMAP_PORT: int = 993
    IMAP_USER: str = ""
    IMAP_PASSWORD: str = ""
    IMAP_FOLDER: str = "INBOX"
    IMAP_POLL_INTERVAL: int = 60  # seconds
    EMAIL_DEFAULT_CATEGORY: str = "other"
    EMAIL_DEFAULT_PRIORITY: str = "medium"

    # Frontend URL (used for portal confirmation emails)
    FRONTEND_URL: str = "http://localhost"

    # Cookie security — H-5: 기본값 True (HTTP 개발 환경에서는 .env에서 False로 설정)
    COOKIE_SECURE: bool = True

    # DB connection pool — 동시 요청 대비 여유 있게 설정 (FastAPI 워커 수 * 1.5 기준)
    DB_POOL_SIZE: int = 30
    DB_MAX_OVERFLOW: int = 20

    # Token
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # ClamAV 바이러스 스캔
    CLAMAV_ENABLED: bool = True
    CLAMAV_HOST: str = "clamav"
    CLAMAV_PORT: int = 3310

    # 세션 최대 개수 (동일 계정 동시 로그인 제한, 0=무제한)
    MAX_ACTIVE_SESSIONS: int = 5

    # Sudo Mode — 고위험 관리자 작업 재인증 (false = 개발 환경에서 비활성화)
    SUDO_MODE_ENABLED: bool = True

    # IP 화이트리스트 — admin/agent 역할 접근 허용 CIDR (빈 문자열=제한 없음)
    # 예: ADMIN_ALLOWED_CIDRS=10.0.0.0/8,192.168.0.0/16
    ADMIN_ALLOWED_CIDRS: str = ""

    # 2FA 강제 적용 역할 (빈 문자열=강제 안 함)
    # 예: REQUIRE_2FA_FOR_ROLES=admin,agent
    REQUIRE_2FA_FOR_ROLES: str = ""

    # GitLab user state check interval (seconds, S-1)
    GITLAB_USER_CHECK_INTERVAL: int = 300

    # GitLab group member sync interval (seconds, S-6) — 퇴사자 동기화
    USER_SYNC_INTERVAL: int = 3600  # 1시간

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_must_be_strong(cls, v: str) -> str:
        weak_defaults = {"change_me", "secret", "your-secret-key", "development-key"}
        if v.lower() in weak_defaults or len(v) < 32:
            raise ValueError(
                "SECRET_KEY가 너무 약합니다. 최소 32자 이상의 강력한 랜덤 키를 설정해 주세요."
            )
        return v

    @field_validator("GITLAB_PROJECT_TOKEN")
    @classmethod
    def warn_if_no_gitlab_token(cls, v: str) -> str:
        if not v:
            logger.warning(
                "GITLAB_PROJECT_TOKEN이 설정되지 않았습니다. GitLab 연동 기능이 제한됩니다."
            )
        return v

    @model_validator(mode="after")
    def log_environment(self) -> "Settings":
        logger.info("🚀 Starting ITSM in '%s' mode", self.ENVIRONMENT)
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]


@lru_cache()
def get_settings() -> Settings:
    """Load settings once and cache for process lifetime.

    Note: Settings changes require process restart.
    For config reload in production, call get_settings.cache_clear()
    followed by get_settings() to reinitialize.
    """
    return Settings()
