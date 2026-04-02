FROM python:3.13-slim
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # glibc 아레나 수 제한 — gunicorn 멀티워커 환경에서 RSS 20-40% 절감
    MALLOC_ARENA_MAX=2

RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 postgresql-client && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --no-create-home --shell /bin/false --uid 998 --gid 0 appuser && \
    chown -R appuser /app && \
    mkdir -p /var/celery && chown appuser /var/celery
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/ready')" || exit 1

# alembic은 첫 프로세스에서만 실행(멱등), 이후 gunicorn이 멀티 워커로 기동
# migration timeout 300s — 초과 시 배포 실패로 명확히 처리
ENV HOME=/tmp
CMD ["sh", "-c", "timeout 300 alembic upgrade head || { echo 'Alembic migration failed or timed out'; exit 1; } && gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w ${WORKERS:-2} --bind 0.0.0.0:8000 --timeout 180 --graceful-timeout 60 --max-requests 1000 --max-requests-jitter 500 --worker-tmp-dir /dev/shm --access-logfile -"]
