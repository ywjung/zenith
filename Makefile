.PHONY: help dev lint test migrate build clean

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

build: ## Build Docker images
	docker compose build

install: ## Install all dependencies
	cd itsm-api && pip install -r requirements-dev.txt
	cd itsm-web && npm ci

pre-commit-install: ## Install pre-commit hooks
	pre-commit install

clean: ## Remove build artifacts and caches
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	rm -f itsm-api/test.db
	rm -rf itsm-web/.next itsm-web/coverage
