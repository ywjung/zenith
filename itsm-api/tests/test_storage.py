"""MinIO storage 모듈 단위 테스트."""
import io
import sys
from unittest.mock import MagicMock, patch

import pytest

# minio 패키지가 설치되어 있지 않은 환경을 위해 sys.modules에 더미 등록
_minio_mock_module = MagicMock()
if "minio" not in sys.modules:
    sys.modules["minio"] = _minio_mock_module


# 각 테스트 전에 싱글톤 초기화
@pytest.fixture(autouse=True)
def reset_storage():
    import app.storage as storage_module
    storage_module._minio_client = None
    storage_module._minio_bucket = ""
    yield
    storage_module._minio_client = None
    storage_module._minio_bucket = ""


# ─── _get_client ─────────────────────────────────────────────────────────────

def test_get_client_returns_none_when_no_endpoint():
    mock_settings = MagicMock()
    mock_settings.MINIO_ENDPOINT = ""
    with patch("app.config.get_settings", return_value=mock_settings):
        from app.storage import _get_client
        result = _get_client()
    assert result is None


def test_get_client_creates_client_and_bucket_when_configured():
    mock_settings = MagicMock()
    mock_settings.MINIO_ENDPOINT = "localhost:9000"
    mock_settings.MINIO_ACCESS_KEY = "access"
    mock_settings.MINIO_SECRET_KEY = "secret"
    mock_settings.MINIO_SECURE = False
    mock_settings.MINIO_BUCKET = "test-bucket"

    mock_minio_instance = MagicMock()
    mock_minio_instance.bucket_exists.return_value = False
    mock_minio_cls = MagicMock(return_value=mock_minio_instance)
    sys.modules["minio"].Minio = mock_minio_cls

    with patch("app.config.get_settings", return_value=mock_settings):
        from app.storage import _get_client
        client = _get_client()

    assert client is mock_minio_instance
    mock_minio_instance.make_bucket.assert_called_once_with("test-bucket")


def test_get_client_does_not_recreate_bucket_if_exists():
    mock_settings = MagicMock()
    mock_settings.MINIO_ENDPOINT = "localhost:9000"
    mock_settings.MINIO_BUCKET = "existing-bucket"

    mock_minio_instance = MagicMock()
    mock_minio_instance.bucket_exists.return_value = True
    sys.modules["minio"].Minio = MagicMock(return_value=mock_minio_instance)

    with patch("app.config.get_settings", return_value=mock_settings):
        from app.storage import _get_client
        _get_client()

    mock_minio_instance.make_bucket.assert_not_called()


def test_get_client_returns_none_on_init_exception():
    mock_settings = MagicMock()
    mock_settings.MINIO_ENDPOINT = "localhost:9000"
    sys.modules["minio"].Minio = MagicMock(side_effect=Exception("connection refused"))

    with patch("app.config.get_settings", return_value=mock_settings):
        from app.storage import _get_client
        result = _get_client()

    assert result is None


def test_get_client_returns_cached_singleton():
    """싱글톤: 두 번째 호출에서 Minio() 를 다시 생성하지 않아야 한다."""
    mock_settings = MagicMock()
    mock_settings.MINIO_ENDPOINT = "localhost:9000"
    mock_settings.MINIO_BUCKET = "bucket"

    mock_minio_instance = MagicMock()
    mock_minio_instance.bucket_exists.return_value = True
    mock_minio_cls = MagicMock(return_value=mock_minio_instance)
    sys.modules["minio"].Minio = mock_minio_cls

    with patch("app.config.get_settings", return_value=mock_settings):
        from app.storage import _get_client
        first = _get_client()
        second = _get_client()

    assert first is second
    assert mock_minio_cls.call_count == 1


# ─── upload_file ─────────────────────────────────────────────────────────────

def test_upload_file_returns_none_when_no_client():
    with patch("app.storage._get_client", return_value=None):
        from app.storage import upload_file
        result = upload_file(b"data", "test.txt", "text/plain")
    assert result is None


def test_upload_file_success():
    mock_client = MagicMock()

    with patch("app.storage._get_client", return_value=mock_client):
        import app.storage as storage_module
        storage_module._minio_bucket = "test-bucket"
        from app.storage import upload_file
        result = upload_file(b"hello", "photo.png", "image/png")

    assert result is not None
    assert result["storage"] == "minio"
    assert result["name"] == "photo.png"
    assert "object_name" in result
    assert result["bucket"] == "test-bucket"
    assert result["url"].startswith("/api/storage/")
    mock_client.put_object.assert_called_once()


def test_upload_file_no_extension():
    mock_client = MagicMock()

    with patch("app.storage._get_client", return_value=mock_client):
        import app.storage as storage_module
        storage_module._minio_bucket = "bucket"
        from app.storage import upload_file
        result = upload_file(b"data", "noextfile", "application/octet-stream")

    assert result is not None
    assert result["name"] == "noextfile"


def test_upload_file_returns_none_on_put_exception():
    mock_client = MagicMock()
    mock_client.put_object.side_effect = Exception("network error")

    with patch("app.storage._get_client", return_value=mock_client):
        from app.storage import upload_file
        result = upload_file(b"data", "fail.txt", "text/plain")

    assert result is None


# ─── get_presigned_url ────────────────────────────────────────────────────────

def test_get_presigned_url_returns_none_when_no_client():
    with patch("app.storage._get_client", return_value=None):
        from app.storage import get_presigned_url
        result = get_presigned_url("some/object")
    assert result is None


def test_get_presigned_url_success():
    mock_client = MagicMock()
    mock_client.presigned_get_object.return_value = "https://minio.example.com/signed?token=abc"

    with patch("app.storage._get_client", return_value=mock_client):
        from app.storage import get_presigned_url
        result = get_presigned_url("attachments/uuid/file.pdf", expires_seconds=7200)

    assert result == "https://minio.example.com/signed?token=abc"
    mock_client.presigned_get_object.assert_called_once()


def test_get_presigned_url_returns_none_on_exception():
    mock_client = MagicMock()
    mock_client.presigned_get_object.side_effect = Exception("timeout")

    with patch("app.storage._get_client", return_value=mock_client):
        from app.storage import get_presigned_url
        result = get_presigned_url("some/object")

    assert result is None


# ─── stream_object ────────────────────────────────────────────────────────────

def test_stream_object_returns_none_tuple_when_no_client():
    with patch("app.storage._get_client", return_value=None):
        from app.storage import stream_object
        data, ct = stream_object("some/object")
    assert data is None
    assert ct is None


def test_stream_object_success():
    mock_response = MagicMock()
    mock_response.headers = {"Content-Type": "image/jpeg"}
    mock_response.read.return_value = b"\xff\xd8\xff"

    mock_client = MagicMock()
    mock_client.get_object.return_value = mock_response

    with patch("app.storage._get_client", return_value=mock_client):
        import app.storage as storage_module
        storage_module._minio_bucket = "bucket"
        from app.storage import stream_object
        data, ct = stream_object("attachments/img.jpg")

    assert data == b"\xff\xd8\xff"
    assert ct == "image/jpeg"
    mock_response.close.assert_called_once()
    mock_response.release_conn.assert_called_once()


def test_stream_object_uses_default_content_type():
    mock_response = MagicMock()
    mock_response.headers = {}
    mock_response.read.return_value = b"rawbytes"

    mock_client = MagicMock()
    mock_client.get_object.return_value = mock_response

    with patch("app.storage._get_client", return_value=mock_client):
        from app.storage import stream_object
        data, ct = stream_object("unknown/file")

    assert ct == "application/octet-stream"


def test_stream_object_returns_none_tuple_on_exception():
    mock_client = MagicMock()
    mock_client.get_object.side_effect = Exception("no such key")

    with patch("app.storage._get_client", return_value=mock_client):
        from app.storage import stream_object
        data, ct = stream_object("missing/object")

    assert data is None
    assert ct is None
