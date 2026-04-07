"""Token encryption utilities using Fernet symmetric encryption.

TOKEN_ENCRYPTION_KEY 환경변수가 설정되면 refresh token을 암호화해 DB에 저장한다.
미설정 시 평문 저장하고 경고만 출력한다 (기존 배포와 호환).

키 생성: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
import logging

logger = logging.getLogger(__name__)

_fernet_instance = None
_fernet_checked = False


def _get_fernet():
    """Fernet 인스턴스 반환. TOKEN_ENCRYPTION_KEY 미설정 시 None."""
    global _fernet_instance, _fernet_checked
    if _fernet_checked:
        return _fernet_instance

    _fernet_checked = True
    try:
        from cryptography.fernet import Fernet
        from .config import get_settings

        key = get_settings().TOKEN_ENCRYPTION_KEY
        if not key:
            logger.warning(
                "TOKEN_ENCRYPTION_KEY not configured — GitLab refresh tokens stored unencrypted. "
                "Set TOKEN_ENCRYPTION_KEY in .env to enable encryption."
            )
            return None
        _fernet_instance = Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as e:
        logger.error("Fernet init failed (TOKEN_ENCRYPTION_KEY may be invalid): %s", e)
        _fernet_instance = None
        _fernet_checked = False  # 키 교체 후 재시도 가능하도록 리셋

    return _fernet_instance


def encrypt_token(value: str) -> str:
    """토큰 문자열을 암호화한다. 키 미설정 시 평문 반환."""
    if not value:
        return value
    fernet = _get_fernet()
    if fernet is None:
        return value
    try:
        return fernet.encrypt(value.encode()).decode()
    except Exception as e:
        logger.error("Token encryption failed: %s", e)
        return value


def decrypt_token(value: str) -> str:
    """토큰 문자열을 복호화한다.

    복호화 실패 시 평문 그대로 반환 (암호화 도입 전 저장된 토큰 하위 호환).
    """
    if not value:
        return value
    fernet = _get_fernet()
    if fernet is None:
        return value
    try:
        return fernet.decrypt(value.encode()).decode()
    except Exception:
        # 암호화 도입 전 저장된 평문 토큰 — 그대로 반환
        logger.debug("Token decryption failed — treating as plain text (pre-encryption token)")
        return value
