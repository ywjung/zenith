#!/usr/bin/env bash
# setup-https.sh — Let's Encrypt 인증서 발급 및 Nginx HTTPS 설정 자동화
# 사용법: sudo bash scripts/setup-https.sh <도메인> <이메일>
# 예시:   sudo bash scripts/setup-https.sh itsm.example.com admin@example.com
#
# 전제 조건:
#   - 도메인의 A 레코드가 이 서버 IP를 가리켜야 함
#   - certbot 설치 필요 (미설치 시 자동 설치)
#   - Docker Compose 기동 중이어야 함 (Nginx 포트 80 사용)
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

# ── 인자 검증 ──────────────────────────────────────────────
if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "사용법: sudo bash $0 <도메인> <이메일>"
  echo "예시:   sudo bash $0 itsm.example.com admin@example.com"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "오류: root 권한으로 실행해야 합니다 (sudo 사용)"
  exit 1
fi

NGINX_CONF_DIR="$(cd "$(dirname "$0")/.." && pwd)/nginx/conf.d"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

echo "=================================================="
echo " ZENITH ITSM — HTTPS 설정 자동화"
echo " 도메인: ${DOMAIN}"
echo " 이메일: ${EMAIL}"
echo "=================================================="

# ── certbot 설치 확인 ──────────────────────────────────────
if ! command -v certbot &>/dev/null; then
  echo "[1/5] certbot 설치 중..."
  apt-get update -qq
  apt-get install -y -qq certbot
else
  echo "[1/5] certbot 이미 설치됨: $(certbot --version 2>&1)"
fi

# ── 인증서 발급 ────────────────────────────────────────────
echo "[2/5] Let's Encrypt 인증서 발급 중..."
# Nginx가 80 포트를 사용 중이므로 --standalone 대신 webroot 방식 사용
# Nginx의 /.well-known/acme-challenge/ 경로를 webroot로 노출해야 함
# 우선 --nginx 플러그인 시도, 없으면 standalone (Nginx 일시 중지)
if certbot plugins 2>/dev/null | grep -q nginx; then
  certbot certonly \
    --nginx \
    --non-interactive \
    --agree-tos \
    --email "${EMAIL}" \
    -d "${DOMAIN}"
else
  # Nginx 컨테이너를 잠시 중지하고 standalone 발급
  echo "  → certbot-nginx 플러그인 없음. Nginx 일시 중지 후 standalone 방식 사용..."
  docker compose stop nginx 2>/dev/null || true
  certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email "${EMAIL}" \
    -d "${DOMAIN}"
  docker compose start nginx 2>/dev/null || true
fi
echo "  ✔ 인증서 발급 완료: ${CERT_DIR}"

# ── Nginx HTTPS 설정 생성 ──────────────────────────────────
echo "[3/5] Nginx HTTPS 설정 생성 중..."
NGINX_HTTPS_CONF="${NGINX_CONF_DIR}/default.conf"

# 기존 설정 백업
if [[ -f "$NGINX_HTTPS_CONF" ]]; then
  cp "$NGINX_HTTPS_CONF" "${NGINX_HTTPS_CONF}.bak.$(date +%Y%m%d%H%M%S)"
  echo "  → 기존 설정 백업 완료"
fi

cat > "$NGINX_HTTPS_CONF" << NGINX_EOF
# ZENITH ITSM — HTTPS 설정 (Let's Encrypt)
# 생성일: $(date)
# 도메인: ${DOMAIN}

# HTTP → HTTPS 리다이렉트
server {
    listen 80;
    server_name ${DOMAIN};

    # ACME 챌린지 (자동 갱신용)
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

# HTTPS 메인 서버
server {
    listen 443 ssl;
    http2 on;
    server_name ${DOMAIN};

    # SSL 인증서
    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    # SSL 보안 설정 (Mozilla Modern)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;

    # HSTS (6개월)
    add_header Strict-Transport-Security "max-age=15768000; includeSubDomains" always;

    # 보안 헤더
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # gzip 압축
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    client_max_body_size 50M;

    # Next.js 웹 UI
    location / {
        proxy_pass http://itsm-web:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # FastAPI
    location /api/ {
        proxy_pass http://itsm-api:8000/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    # WebSocket (실시간 알림)
    location /api/ws/ {
        proxy_pass http://itsm-api:8000/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 3600s;
    }

    # Grafana
    location /grafana/ {
        proxy_pass http://grafana:3000/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Prometheus (내부 접근만 허용)
    location /prometheus/ {
        allow 127.0.0.1;
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny all;
        proxy_pass http://prometheus:9090/prometheus/;
        proxy_set_header Host \$host;
    }
}
NGINX_EOF
echo "  ✔ Nginx 설정 완료: ${NGINX_HTTPS_CONF}"

# ── docker-compose.yml에 인증서 볼륨 마운트 안내 ───────────
echo "[4/5] docker-compose.yml 업데이트 필요 사항 안내"
cat << INFO

  ⚠️  docker-compose.yml의 nginx 서비스에 아래 볼륨을 추가해야 합니다:

  nginx:
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro   ← 추가
      - /var/www/certbot:/var/www/certbot:ro   ← 추가 (자동갱신용)

INFO

# ── 자동 갱신 크론 등록 ────────────────────────────────────
echo "[5/5] 자동 갱신 크론 등록 중..."
CRON_JOB="0 3 * * * certbot renew --quiet --post-hook 'docker compose -f $(cd "$(dirname "$0")/.." && pwd)/docker-compose.yml exec nginx nginx -s reload'"
(crontab -l 2>/dev/null | grep -v "certbot renew"; echo "$CRON_JOB") | crontab -
echo "  ✔ 자동 갱신 크론 등록 완료 (매일 오전 3시)"

echo ""
echo "=================================================="
echo " ✅ HTTPS 설정 완료!"
echo ""
echo " 다음 단계:"
echo "   1. docker-compose.yml에 인증서 볼륨 추가 (위 안내 참조)"
echo "   2. docker compose down && docker compose up -d"
echo "   3. https://${DOMAIN} 접속 확인"
echo "=================================================="
