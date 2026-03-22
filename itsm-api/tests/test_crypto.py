"""Unit tests for app/crypto.py — Fernet token encryption utilities."""
from unittest.mock import patch, MagicMock


def _reset_crypto():
    """Reset module-level singletons so _get_fernet re-initialises."""
    import app.crypto as m
    m._fernet_instance = None
    m._fernet_checked = False


def _valid_key():
    from cryptography.fernet import Fernet
    return Fernet.generate_key().decode()


# ── _get_fernet ────────────────────────────────────────────────────────────────

def test_get_fernet_no_key_returns_none():
    _reset_crypto()
    from app.crypto import _get_fernet
    result = _get_fernet()
    assert result is None


def test_get_fernet_caches_result():
    """Second call returns cached instance (checked=True path)."""
    _reset_crypto()
    from app.crypto import _get_fernet
    r1 = _get_fernet()
    r2 = _get_fernet()
    assert r1 is r2


def test_get_fernet_with_valid_key():
    _reset_crypto()
    key = _valid_key()
    with patch("app.config.get_settings") as mock_s:
        mock_s.return_value.TOKEN_ENCRYPTION_KEY = key
        from app.crypto import _get_fernet
        result = _get_fernet()
    assert result is not None


def test_get_fernet_invalid_key_returns_none():
    """Invalid key → Fernet raises → returns None."""
    _reset_crypto()
    with patch("app.config.get_settings") as mock_s:
        mock_s.return_value.TOKEN_ENCRYPTION_KEY = "bad-key"
        from app.crypto import _get_fernet
        result = _get_fernet()
    assert result is None


# ── encrypt_token ──────────────────────────────────────────────────────────────

def test_encrypt_token_empty_returns_empty():
    from app.crypto import encrypt_token
    assert encrypt_token("") == ""
    assert encrypt_token(None) is None


def test_encrypt_token_no_key_returns_plain():
    _reset_crypto()
    from app.crypto import encrypt_token
    result = encrypt_token("my-secret-token")
    assert result == "my-secret-token"


def test_encrypt_token_with_key_returns_ciphertext():
    _reset_crypto()
    key = _valid_key()
    with patch("app.config.get_settings") as mock_s:
        mock_s.return_value.TOKEN_ENCRYPTION_KEY = key
        from app.crypto import encrypt_token
        result = encrypt_token("my-token")
    assert result != "my-token"
    assert len(result) > 0


def test_encrypt_token_exception_returns_plain():
    """fernet.encrypt raises → return original plain text."""
    _reset_crypto()
    mock_fernet = MagicMock()
    mock_fernet.encrypt.side_effect = Exception("encryption error")
    with patch("app.crypto._get_fernet", return_value=mock_fernet):
        from app.crypto import encrypt_token
        result = encrypt_token("my-token")
    assert result == "my-token"


# ── decrypt_token ──────────────────────────────────────────────────────────────

def test_decrypt_token_empty_returns_empty():
    from app.crypto import decrypt_token
    assert decrypt_token("") == ""
    assert decrypt_token(None) is None


def test_decrypt_token_no_key_returns_plain():
    _reset_crypto()
    from app.crypto import decrypt_token
    result = decrypt_token("plain-token")
    assert result == "plain-token"


def test_decrypt_token_roundtrip():
    """Encrypt → decrypt restores original value."""
    _reset_crypto()
    key = _valid_key()
    with patch("app.config.get_settings") as mock_s:
        mock_s.return_value.TOKEN_ENCRYPTION_KEY = key
        from app.crypto import encrypt_token, decrypt_token
        ciphertext = encrypt_token("original-token")
    # reset so decrypt re-initializes fernet with same key
    _reset_crypto()
    with patch("app.config.get_settings") as mock_s:
        mock_s.return_value.TOKEN_ENCRYPTION_KEY = key
        from app.crypto import decrypt_token
        plaintext = decrypt_token(ciphertext)
    assert plaintext == "original-token"


def test_decrypt_token_plain_text_fallback():
    """Decrypting an unencrypted token returns it unchanged."""
    _reset_crypto()
    key = _valid_key()
    with patch("app.config.get_settings") as mock_s:
        mock_s.return_value.TOKEN_ENCRYPTION_KEY = key
        from app.crypto import decrypt_token
        result = decrypt_token("not-encrypted-at-all")
    assert result == "not-encrypted-at-all"
