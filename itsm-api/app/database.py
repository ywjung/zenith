from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from .config import get_settings

_settings = get_settings()

engine = create_engine(
    _settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=_settings.DB_POOL_SIZE,
    max_overflow=_settings.DB_MAX_OVERFLOW,
    # 연결 재활용 시 statement_timeout 세션 변수 적용 (30 s)
    connect_args={"options": "-c statement_timeout=30000"},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# Prometheus 메트릭: 연결 풀 사용률 → QueuePool limit reached 사고 조기 감지.
try:
    from prometheus_client import Gauge as _Gauge

    _pool_checked_out = _Gauge("sqlalchemy_pool_checked_out", "현재 체크아웃된 DB 연결 수")
    _pool_checked_in = _Gauge("sqlalchemy_pool_checked_in", "풀 내 가용 DB 연결 수")
    _pool_overflow = _Gauge("sqlalchemy_pool_overflow", "overflow 사용 중인 연결 수")
    _pool_size_metric = _Gauge("sqlalchemy_pool_size_configured", "설정된 pool_size")
    _pool_size_metric.set(_settings.DB_POOL_SIZE)

    def _refresh_pool_metrics() -> None:
        try:
            p = engine.pool
            _pool_checked_out.set(p.checkedout())
            _pool_checked_in.set(p.checkedin())
            ov = getattr(p, "overflow", None)
            if callable(ov):
                _pool_overflow.set(ov())
        except Exception:
            pass

    import threading as _threading

    def _pool_metrics_loop() -> None:
        import time as _t
        while True:
            _refresh_pool_metrics()
            _t.sleep(15)

    _t = _threading.Thread(target=_pool_metrics_loop, daemon=True, name="sqlalchemy-pool-metrics")
    _t.start()
except Exception:
    pass


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
