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
    # Celery broker (없으면 REDIS_URL을 그대로 사용)
    CELERY_BROKER_URL: str = ""

    # OpenTelemetry
    OTEL_ENABLED: bool = False
    OTEL_EXPORTER_OTLP_ENDPOINT: str = "http://otel-collector:4317"
    OTEL_SERVICE_NAME: str = "itsm-api"

    # DB 프로파일러
    SLOW_QUERY_THRESHOLD_MS: float = 200.0

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

    # Slack
    SLACK_ENABLED: bool = False
    SLACK_WEBHOOK_URL: str = ""   # Incoming Webhook URL
    SLACK_CHANNEL: str = ""       # 기본 채널 (예: #itsm-alerts), 웹훅에서 설정된 채널 오버라이드용

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

    # Token — MED-06: 기본 7일로 단축 (기존 30일 → 과도한 세션 유효기간)
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ClamAV 바이러스 스캔
    CLAMAV_ENABLED: bool = True
    CLAMAV_HOST: str = "itsm-clamav-1"
    CLAMAV_PORT: int = 3310
    # CLAMAV_STRICT는 레거시 설정 — clamav.py 모듈은 항상 fail-open으로 동작한다.
    # helpers._scan_with_clamav 호환성을 위해 유지.
    CLAMAV_STRICT: bool = False

    # MinIO / S3 호환 오브젝트 스토리지 — 설정 시 GitLab 업로드 대체
    # MINIO_ENDPOINT 미설정 시 기존 GitLab 업로드 방식 사용
    MINIO_ENDPOINT: str = ""          # 예: minio:9000
    MINIO_ACCESS_KEY: str = ""
    MINIO_SECRET_KEY: str = ""
    MINIO_BUCKET: str = "itsm-attachments"
    MINIO_SECURE: bool = True         # False = HTTP (개발 환경에서만 명시적으로 False 설정)

    # Web Push / VAPID
    # Generate keys: python -c "from py_vapid import Vapid; v=Vapid(); v.generate_keys(); print('VAPID_PRIVATE_KEY:', v.private_key); print('VAPID_PUBLIC_KEY:', v.public_key)"
    VAPID_PRIVATE_KEY: str = ""   # URL-safe base64 raw private key
    VAPID_PUBLIC_KEY: str = ""    # URL-safe base64 uncompressed public key (65 bytes)
    VAPID_EMAIL: str = "mailto:admin@example.com"  # contact email for push service

    # AI 요약 (Anthropic Claude)
    ANTHROPIC_API_KEY: str = ""   # Claude API 키 — 미설정 시 AI 요약 비활성화
    ANTHROPIC_MODEL: str = "claude-haiku-4-5-20251001"  # Claude 모델 ID

    # 세션 최대 개수 (동일 계정 동시 로그인 제한, 0=무제한)
    MAX_ACTIVE_SESSIONS: int = 5

    # Sudo Mode — 고위험 관리자 작업 재인증 (false = 개발 환경에서 비활성화)
    SUDO_MODE_ENABLED: bool = True

    # IP 화이트리스트 — admin/agent 역할 접근 허용 CIDR (빈 문자열=제한 없음)
    # 예: ADMIN_ALLOWED_CIDRS=10.0.0.0/8,192.168.0.0/16
    ADMIN_ALLOWED_CIDRS: str = ""

    # 신뢰할 프록시 IP/CIDR 목록 — X-Forwarded-For 헤더를 신뢰할 프록시 주소
    # 빈 문자열: 사설 IP 전체 신뢰 (하위 호환 기본값)
    # 예: TRUSTED_PROXIES=10.0.0.0/8,172.16.0.0/12
    TRUSTED_PROXIES: str = ""

    # 백업 디렉토리 — /tmp는 컨테이너 재시작 시 소멸하므로 영구 볼륨 경로 지정 권장
    BACKUP_DIR: str = "/tmp/itsm_backups"

    # 백업 암호화 키 — SECRET_KEY와 독립적으로 관리하여 JWT 시크릿 교체 시에도 기존 백업 복호화 가능
    # 미설정 시 SECRET_KEY에서 HKDF 파생 (하위 호환). 신규 설치는 반드시 별도 설정 권장.
    # 생성: python -c "import secrets; print(secrets.token_hex(32))"
    BACKUP_ENCRYPTION_KEY: str = ""

    # 2FA 강제 적용 역할 (빈 문자열=강제 안 함)
    # 예: REQUIRE_2FA_FOR_ROLES=admin,agent
    REQUIRE_2FA_FOR_ROLES: str = ""

    # GitLab user state check interval (seconds, S-1)
    GITLAB_USER_CHECK_INTERVAL: int = 300

    # GitLab group member sync interval (seconds, S-6) — 퇴사자 동기화
    USER_SYNC_INTERVAL: int = 3600  # 1시간
    # USER_SYNC_REQUIRE_GROUP=true (기본): 그룹 멤버에서 제거되면 비활성 (프로젝트만 남아도 차단)
    # USER_SYNC_REQUIRE_GROUP=false: 그룹 OR 프로젝트 멤버이면 활성 유지
    USER_SYNC_REQUIRE_GROUP: bool = True

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_must_be_strong(cls, v: str) -> str:
        # CRIT-02: 기본값 포함 — 공개 레포에 노출된 기본값 차단
        weak_defaults = {
            "change_me", "secret", "your-secret-key", "development-key",
            "change_me_to_random_32char_string",
        }
        if v.lower() in {w.lower() for w in weak_defaults} or len(v) < 32:
            raise ValueError(
                "SECRET_KEY가 너무 약합니다. 최소 32자 이상의 강력한 랜덤 키를 설정해 주세요."
            )
        return v

    @field_validator("CORS_ORIGINS")
    @classmethod
    def cors_no_wildcard_in_production(cls, v: str) -> str:
        # LOW-03: 와일드카드 CORS 허용 방지
        if "*" in v:
            logger.warning("CORS_ORIGINS에 와일드카드(*)가 포함되어 있습니다. 프로덕션에서는 명시적 출처를 지정하세요.")
        return v

    # 기본값으로 남으면 위험한 시크릿 목록 (값, 설명)
    _INSECURE_DEFAULTS: tuple[tuple[str, str], ...] = (
        ("change_me_to_random_32char_string", "SECRET_KEY"),
        ("changeme", "POSTGRES_PASSWORD (DATABASE_URL)"),
        ("change_me_redis_password", "REDIS_PASSWORD (REDIS_URL)"),
    )

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        is_prod = self.ENVIRONMENT == "production"

        # 프로덕션 전용 강제 검증
        if is_prod:
            # H-04: 웹훅 시크릿 미설정 시 GitLab 이벤트 위조 가능 → 기동 거부
            if not self.GITLAB_WEBHOOK_SECRET:
                raise ValueError(
                    "GITLAB_WEBHOOK_SECRET이 설정되지 않았습니다. "
                    "프로덕션에서는 필수입니다. "
                    "생성: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
                )
            # SEC: 프로덕션에서 토큰 암호화 키 미설정 시 기동 거부
            if not self.TOKEN_ENCRYPTION_KEY:
                raise ValueError(
                    "TOKEN_ENCRYPTION_KEY가 설정되지 않았습니다. "
                    "프로덕션 환경에서는 필수입니다. "
                    "생성: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
                )
            if "*" in self.CORS_ORIGINS:
                raise ValueError("프로덕션에서는 CORS_ORIGINS에 와일드카드(*)를 사용할 수 없습니다.")

            # SECRET_KEY 기본값 사용 여부 확인
            if self.SECRET_KEY == "change_me_to_random_32char_string":
                raise ValueError(
                    "SECRET_KEY가 기본값입니다. 프로덕션에서는 안전한 랜덤 값으로 교체하세요. "
                    "생성: python -c \"import secrets; print(secrets.token_hex(32))\""
                )

            # DATABASE_URL / REDIS_URL에 기본(취약) 패스워드 포함 여부 — 프로덕션 거부
            if "changeme" in self.DATABASE_URL:
                raise ValueError(
                    "DATABASE_URL에 기본 패스워드('changeme')가 포함되어 있습니다. "
                    "프로덕션에서는 강력한 패스워드로 교체하세요."
                )
            if "change_me_redis_password" in self.REDIS_URL:
                raise ValueError(
                    "REDIS_URL에 기본 패스워드가 포함되어 있습니다. "
                    "프로덕션에서는 강력한 패스워드로 교체하세요."
                )

            # GitLab 연동이 이 앱의 핵심이므로 프로덕션에서는 토큰 필수
            if not self.GITLAB_PROJECT_TOKEN:
                raise ValueError(
                    "GITLAB_PROJECT_TOKEN이 설정되지 않았습니다. 프로덕션에서는 필수입니다."
                )

        # 환경 무관: 기본 시크릿 사용 시 WARNING 로그
        # 각 필드를 개별 비교 — 시크릿을 하나의 문자열로 합치면 스택트레이스 노출 위험
        _field_values = {
            "SECRET_KEY": self.SECRET_KEY,
            "POSTGRES_PASSWORD (DATABASE_URL)": self.DATABASE_URL,
            "REDIS_PASSWORD (REDIS_URL)": self.REDIS_URL,
        }
        for default_val, field_name in self._INSECURE_DEFAULTS:
            field_val = _field_values.get(field_name, "")
            if default_val in field_val:
                logger.warning(
                    "⚠️  보안 경고: %s 가 기본(예시) 값으로 설정되어 있습니다. "
                    "프로덕션 배포 전에 반드시 변경하세요!", field_name
                )

        return self

    @model_validator(mode="after")
    def validate_integration_settings(self) -> "Settings":
        # SMTP: NOTIFICATION_ENABLED=true 시 필수 항목 확인
        if self.NOTIFICATION_ENABLED:
            missing = [f for f, v in [
                ("SMTP_HOST", self.SMTP_HOST),
                ("SMTP_USER", self.SMTP_USER),
                ("SMTP_PASSWORD", self.SMTP_PASSWORD),
            ] if not v]
            if missing:
                raise ValueError(
                    f"NOTIFICATION_ENABLED=true 이지만 다음 항목이 설정되지 않았습니다: {', '.join(missing)}"
                )

        # MinIO: MINIO_ENDPOINT 설정 시 ACCESS_KEY/SECRET_KEY 필수 + 취약 기본값 거부
        if self.MINIO_ENDPOINT:
            if not self.MINIO_ACCESS_KEY or not self.MINIO_SECRET_KEY:
                raise ValueError(
                    "MINIO_ENDPOINT가 설정된 경우 MINIO_ACCESS_KEY와 MINIO_SECRET_KEY가 필요합니다."
                )
            _minio_weak = {"minio_admin", "minio_secret_change_me", "minioadmin", "minio"}
            if self.MINIO_ACCESS_KEY in _minio_weak or self.MINIO_SECRET_KEY in _minio_weak:
                raise ValueError(
                    "MINIO_ACCESS_KEY / MINIO_SECRET_KEY가 기본(예시) 값입니다. "
                    "프로덕션 배포 전에 반드시 강력한 자격증명으로 변경하세요."
                )

        # IMAP: IMAP_ENABLED=true 시 필수 항목 확인
        if self.IMAP_ENABLED:
            missing = [f for f, v in [
                ("IMAP_HOST", self.IMAP_HOST),
                ("IMAP_USER", self.IMAP_USER),
                ("IMAP_PASSWORD", self.IMAP_PASSWORD),
            ] if not v]
            if missing:
                raise ValueError(
                    f"IMAP_ENABLED=true 이지만 다음 항목이 설정되지 않았습니다: {', '.join(missing)}"
                )

        return self

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
        logger.info("Starting ITSM in '%s' mode", self.ENVIRONMENT)
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    @property
    def postgres_url_parts(self) -> dict:
        """DATABASE_URL에서 PostgreSQL 접속 정보를 파싱합니다. (CRIT-2)"""
        from urllib.parse import urlparse
        url = self.DATABASE_URL
        for prefix in ("postgresql+psycopg://", "postgresql+asyncpg://", "postgres://"):
            if url.startswith(prefix):
                url = "postgresql://" + url[len(prefix):]
                break
        parsed = urlparse(url)
        return {
            "user": parsed.username or "itsm",
            "password": parsed.password or "",
            "host": parsed.hostname or "postgres",
            "port": str(parsed.port or 5432),
            "db": (parsed.path or "/itsm").lstrip("/") or "itsm",
        }


@lru_cache()
def get_settings() -> Settings:
    """Load settings once and cache for process lifetime.

    Note: Settings changes require process restart.
    For config reload in production, call get_settings.cache_clear()
    followed by get_settings() to reinitialize.
    """
    return Settings()
