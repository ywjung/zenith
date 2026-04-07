"""OpenTelemetry 분산 추적 설정.

OTEL_ENABLED=true 환경 변수로 활성화. 기본 비활성(개발 환경 호환성).
"""
import logging

logger = logging.getLogger(__name__)


def setup_telemetry(app) -> None:
    """FastAPI 앱에 OpenTelemetry 계측을 적용합니다.

    환경 변수:
        OTEL_ENABLED: 'true'로 설정 시 추적 활성화 (기본: false)
        OTEL_EXPORTER_OTLP_ENDPOINT: OTLP gRPC 엔드포인트 (기본: http://otel-collector:4317)
        OTEL_SERVICE_NAME: 서비스 이름 (기본: itsm-api)
    """
    from .config import get_settings
    settings = get_settings()

    if not settings.OTEL_ENABLED:
        return

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.sdk.resources import Resource, SERVICE_NAME
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    except ImportError as e:
        logger.warning("OpenTelemetry 패키지 미설치 — 추적 비활성화: %s", e)
        return

    resource = Resource(attributes={SERVICE_NAME: settings.OTEL_SERVICE_NAME})
    provider = TracerProvider(resource=resource)

    otel_insecure = settings.ENVIRONMENT != "production"
    exporter = OTLPSpanExporter(endpoint=settings.OTEL_EXPORTER_OTLP_ENDPOINT, insecure=otel_insecure)
    provider.add_span_processor(BatchSpanProcessor(exporter))

    trace.set_tracer_provider(provider)

    FastAPIInstrumentor.instrument_app(app)

    # SQLAlchemy 계측은 엔진 생성 후 호출해야 하므로 이벤트로 등록
    from .database import engine as db_engine
    SQLAlchemyInstrumentor().instrument(engine=db_engine, enable_commenter=True)

    logger.info(
        "OpenTelemetry 추적 활성화: service=%s endpoint=%s",
        settings.OTEL_SERVICE_NAME,
        settings.OTEL_EXPORTER_OTLP_ENDPOINT,
    )
