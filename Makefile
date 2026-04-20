.PHONY: help dev lint test migrate build clean setup setup-bundle setup-external down status logs

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

dev: ## Start development environment
	docker compose up -d

dev-down: ## Stop development environment
	docker compose down

lint: ## Run all linters
	@echo "→ ruff (backend)"
	cd itsm-api && ruff check app/
	@echo "→ eslint (frontend)"
	cd itsm-web && npm run lint

test: ## Run all tests
	@echo "→ pytest (backend)"
	cd itsm-api && pytest tests/ -v --cov=app
	@echo "→ jest (frontend)"
	cd itsm-web && npm test

test-backend: ## Run backend tests only
	cd itsm-api && pytest tests/ -v --cov=app

test-frontend: ## Run frontend tests only
	cd itsm-web && npm test

migrate: ## Run Alembic migrations (requires running postgres)
	docker compose exec itsm-api alembic upgrade head

migrate-create: ## Create a new migration (usage: make migrate-create MSG="your message")
	docker compose exec itsm-api alembic revision --autogenerate -m "$(MSG)"

build: ## Build and redeploy all services
	docker compose build
	docker compose up -d

build-api: ## Build and redeploy backend only (+ nginx reload for fresh upstream IP)
	docker compose build itsm-api
	docker compose up -d itsm-api
	docker compose restart nginx

build-web: ## Build and redeploy frontend only (+ nginx reload for fresh upstream IP)
	docker compose build itsm-web
	docker compose up -d itsm-web
	docker compose restart nginx

redeploy: ## Rebuild api+web together then reload nginx (safe default for dev)
	docker compose build itsm-api itsm-web
	docker compose up -d itsm-api itsm-web
	docker compose restart nginx

nginx-check: ## Render nginx template & run nginx -t (pre-merge sanity)
	docker run --rm \
	  -v "$(PWD)/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
	  -v "$(PWD)/nginx/templates:/etc/nginx/templates:ro" \
	  -v "$(PWD)/nginx/conf.d:/etc/nginx/conf.d:ro" \
	  nginx:1.27-alpine sh -c '/docker-entrypoint.d/20-envsubst-on-templates.sh && nginx -t'

install: ## Install dev dependencies (python + npm)
	cd itsm-api && pip install -r requirements-dev.txt
	cd itsm-web && npm ci

pre-commit-install: ## Install pre-commit hooks
	pre-commit install

# ─── Production install launcher ─────────────────────────────────────────────
setup: ## Production install (interactive mode selector)
	./scripts/install.sh

setup-bundle: ## Production install — bundled GitLab
	./scripts/install.sh --mode bundle

setup-external: ## Production install — connect to existing GitLab
	./scripts/install.sh --mode external

# ─── Compose operations (external-gitlab aware) ─────────────────────────────
# USE_EXTERNAL_GITLAB=1 make <target> 으로 외부 GitLab override 적용
ifeq ($(USE_EXTERNAL_GITLAB),1)
  COMPOSE_FILES := -f docker-compose.yml -f docker-compose.external-gitlab.yml
else
  COMPOSE_FILES :=
endif

up: ## Start all services (USE_EXTERNAL_GITLAB=1 for external mode)
	docker compose $(COMPOSE_FILES) up -d

down: ## Stop all services
	docker compose $(COMPOSE_FILES) down

status: ## Show container status
	docker compose $(COMPOSE_FILES) ps

logs: ## Tail API logs (SVC=<name> to change, default itsm-api)
	docker compose $(COMPOSE_FILES) logs -f $(or $(SVC),itsm-api)

health: ## Check API health
	@curl -fsS http://localhost:$${APP_PORT:-8111}/api/health | python3 -m json.tool

clean: ## Remove build artifacts and caches
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	rm -f itsm-api/test.db
	rm -rf itsm-web/.next itsm-web/coverage
