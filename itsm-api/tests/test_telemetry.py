"""Tests for app/telemetry.py — OTEL setup paths."""
import sys
from unittest.mock import patch, MagicMock, call


def test_setup_telemetry_disabled():
    """When OTEL_ENABLED is False, setup_telemetry returns immediately (line 22)."""
    from app.telemetry import setup_telemetry

    mock_app = MagicMock()
    with patch("app.config.get_settings") as mock_cfg:
        mock_cfg.return_value.OTEL_ENABLED = False
        setup_telemetry(mock_app)
    # Returned early — no instrumentation


def test_setup_telemetry_import_error():
    """When OTEL_ENABLED=True but opentelemetry not installed → ImportError (lines 24-34)."""
    from app.telemetry import setup_telemetry

    mock_app = MagicMock()
    # Setting sys.modules entries to None forces ImportError for those imports
    blocked = {
        "opentelemetry": None,
        "opentelemetry.trace": None,
        "opentelemetry.sdk": None,
        "opentelemetry.sdk.trace": None,
        "opentelemetry.sdk.trace.export": None,
        "opentelemetry.sdk.resources": None,
        "opentelemetry.exporter": None,
        "opentelemetry.exporter.otlp": None,
        "opentelemetry.exporter.otlp.proto": None,
        "opentelemetry.exporter.otlp.proto.grpc": None,
        "opentelemetry.exporter.otlp.proto.grpc.trace_exporter": None,
        "opentelemetry.instrumentation": None,
        "opentelemetry.instrumentation.fastapi": None,
        "opentelemetry.instrumentation.sqlalchemy": None,
    }
    with (
        patch("app.config.get_settings") as mock_cfg,
        patch.dict(sys.modules, blocked),
    ):
        mock_cfg.return_value.OTEL_ENABLED = True
        mock_cfg.return_value.OTEL_SERVICE_NAME = "itsm-api"
        mock_cfg.return_value.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel:4317"
        setup_telemetry(mock_app)
    # ImportError caught and logged — no exception propagated


def test_setup_telemetry_enabled_success():
    """When OTEL_ENABLED=True and all imports succeed → instrumentation runs (lines 36-54)."""
    from app.telemetry import setup_telemetry

    mock_app = MagicMock()

    # Create fake otel modules
    mock_trace = MagicMock()
    mock_provider = MagicMock()
    mock_exporter = MagicMock()
    mock_processor = MagicMock()
    mock_resource_cls = MagicMock(return_value=MagicMock())
    mock_tracer_provider_cls = MagicMock(return_value=mock_provider)
    mock_otlp_cls = MagicMock(return_value=mock_exporter)
    mock_bsp_cls = MagicMock(return_value=mock_processor)
    mock_fastapi_instrumentor = MagicMock()
    mock_sqlalchemy_instrumentor_instance = MagicMock()
    mock_sqlalchemy_instrumentor_cls = MagicMock(return_value=mock_sqlalchemy_instrumentor_instance)

    fake_otel = MagicMock()
    fake_otel.trace = mock_trace  # ensures `from opentelemetry import trace` → mock_trace
    fake_otel_sdk_trace = MagicMock()
    fake_otel_sdk_trace_export = MagicMock()
    fake_otel_sdk_resources = MagicMock()
    fake_otel_sdk_resources.Resource = mock_resource_cls
    fake_otel_sdk_resources.SERVICE_NAME = "service.name"
    fake_otel_exporter_otlp_grpc = MagicMock()
    fake_otel_instr_fastapi = MagicMock()
    fake_otel_instr_sqlalchemy = MagicMock()

    modules = {
        "opentelemetry": fake_otel,
        "opentelemetry.trace": mock_trace,
        "opentelemetry.sdk": MagicMock(),
        "opentelemetry.sdk.trace": fake_otel_sdk_trace,
        "opentelemetry.sdk.trace.export": fake_otel_sdk_trace_export,
        "opentelemetry.sdk.resources": fake_otel_sdk_resources,
        "opentelemetry.exporter": MagicMock(),
        "opentelemetry.exporter.otlp": MagicMock(),
        "opentelemetry.exporter.otlp.proto": MagicMock(),
        "opentelemetry.exporter.otlp.proto.grpc": MagicMock(),
        "opentelemetry.exporter.otlp.proto.grpc.trace_exporter": fake_otel_exporter_otlp_grpc,
        "opentelemetry.instrumentation": MagicMock(),
        "opentelemetry.instrumentation.fastapi": fake_otel_instr_fastapi,
        "opentelemetry.instrumentation.sqlalchemy": fake_otel_instr_sqlalchemy,
    }
    fake_otel_sdk_trace.TracerProvider = mock_tracer_provider_cls
    fake_otel_sdk_trace_export.BatchSpanProcessor = mock_bsp_cls
    fake_otel_exporter_otlp_grpc.OTLPSpanExporter = mock_otlp_cls
    fake_otel_instr_fastapi.FastAPIInstrumentor = mock_fastapi_instrumentor
    fake_otel_instr_sqlalchemy.SQLAlchemyInstrumentor = mock_sqlalchemy_instrumentor_cls

    with (
        patch("app.config.get_settings") as mock_cfg,
        patch.dict(sys.modules, modules),
        patch("app.database.engine", MagicMock()),
    ):
        mock_cfg.return_value.OTEL_ENABLED = True
        mock_cfg.return_value.OTEL_SERVICE_NAME = "itsm-api"
        mock_cfg.return_value.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel:4317"
        setup_telemetry(mock_app)

    # Verify instrumentation was set up
    mock_tracer_provider_cls.assert_called_once()
    mock_provider.add_span_processor.assert_called_once()
    mock_trace.set_tracer_provider.assert_called_once_with(mock_provider)
    mock_fastapi_instrumentor.instrument_app.assert_called_once_with(mock_app)
    mock_sqlalchemy_instrumentor_instance.instrument.assert_called_once()
