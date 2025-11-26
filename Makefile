# MADE Makefile
# Provides common development tasks for the MADE project

PORT ?= 3000
FRONTEND_PORT ?= 5173
HOST ?= 0.0.0.0
PYBACKEND_DIR := packages/pybackend

.PHONY: help lint format test unit-test system-test qa qa-quick build run clean install install-node install-pybackend test-coverage backend-coverage docker-build docker-up docker-down docker-dev docker-clean

# Default target
help:
	@echo "MADE Development Tasks"
	@echo "======================"
	@echo ""
	@echo "Quality Assurance:"
	@echo "  format        Format frontend and backend code"
	@echo "  lint          Run frontend and backend linters"
	@echo "  test          Run all tests (frontend + backend with coverage)"
	@echo "  unit-test     Run unit tests only (frontend + backend)"
	@echo "  system-test   Run system tests only (frontend + backend)"
	@echo "  qa            Run all quality assurance tasks (lint + format + test)"
	@echo "  qa-quick      Run all quick quality assurance tasks (lint + format + unit-test)"
	@echo "  test-coverage Run full test suite with coverage reporting"
	@echo "  backend-coverage  Run backend tests with detailed coverage (70% minimum)"
	@echo ""
	@echo "Docker:"
	@echo "  docker-build   Build all Docker images"
	@echo "  docker-up      Start all services with Docker Compose"
	@echo "  docker-down    Stop all Docker services"
	@echo "  docker-dev     Start services in development mode (with hot reload)"
	@echo "  docker-clean   Stop services and remove volumes/images"
	@echo ""
	@echo "Build & Run:"
	@echo "  build     Build the project"
	@echo "  run       Start the frontend and Python backend together"
	@echo ""
	@echo "Maintenance:"
	@echo "  install   Install/sync dependencies"
	@echo "  clean     Clean build artifacts and cache"
	@echo ""
	@echo "Example usage:"
	@echo "  make qa                        # Run all quality checks"
	@echo "  make backend-coverage          # Run backend tests with detailed coverage"
	@echo "  make docker-build              # Build Docker images"
	@echo "  make docker-dev                # Start development environment"
	@echo "  make run PORT=3000 FRONTEND_PORT=5173  # Start frontend + Python backend"

# Quality Assurance Tasks
format:
	@echo "🎨 Formatting frontend code..."
	npm run format
	@echo "🎨 Formatting backend code with ruff..."
	cd $(PYBACKEND_DIR) && uv run ruff format *.py
	cd $(PYBACKEND_DIR) && uv run ruff check --fix *.py

lint:
	@echo "🔍 Running frontend linter..."
	npm run lint
	@echo "🔍 Running backend ruff linter..."
	cd $(PYBACKEND_DIR) && uv run ruff check *.py

test:
	@echo "🧪 Running frontend tests..."
	npm test
	@echo "🧪 Running backend tests with coverage..."
	cd $(PYBACKEND_DIR) && uv sync && uv run pytest --cov=. --cov-report=term-missing

unit-test:
	@echo "🔬 Running frontend unit tests..."
	npm test
	@echo "🔬 Running backend unit tests with coverage..."
	cd $(PYBACKEND_DIR) && uv sync && uv run pytest tests/unit/ -v --cov=. --cov-report=term-missing

system-test:
	@echo "🏗️ Running frontend system tests..."
	npm run test:e2e
	@echo "🏗️ Running backend system tests..."
	cd $(PYBACKEND_DIR) && uv sync && uv run pytest tests/system/ -v

qa: format lint test
	@echo "✅ All quality assurance tasks completed successfully!"

qa-quick: format lint unit-test
	@echo "✅ All quick quality assurance tasks completed successfully!"

# Coverage Tasks
test-coverage: 
	@echo "📊 Running full test suite with coverage..."
	@echo "📊 Frontend tests..."
	npm test
	@echo "📊 Backend tests with detailed coverage..."
	cd $(PYBACKEND_DIR) && uv sync && uv run pytest --cov=. --cov-report=term-missing --cov-report=html:htmlcov --cov-fail-under=70

backend-coverage:
	@echo "📊 Running backend tests with detailed coverage report..."
	cd $(PYBACKEND_DIR) && uv sync && uv run pytest --cov=. --cov-report=term-missing --cov-report=html:htmlcov --cov-branch --cov-fail-under=70
	@echo "📊 Coverage report generated in packages/pybackend/htmlcov/"

# Build & Run Tasks
build:
	@echo "📦 Building frontend..."
	npm run build
	@echo "📦 Building backend package..."
	cd $(PYBACKEND_DIR) && uv build

run:
	@echo "🚀 Starting MADE frontend on $(HOST):$(FRONTEND_PORT) and Python backend on $(HOST):$(PORT)..."
	@echo "Press Ctrl+C to stop both services."
	npm --workspace packages/frontend run dev -- --host $(HOST) --port $(FRONTEND_PORT) & \
	FRONTEND_PID=$$!; \
	trap 'echo "⏹️  Stopping frontend (PID $$FRONTEND_PID)..."; kill $$FRONTEND_PID 2>/dev/null || true' EXIT INT TERM; \
	cd $(PYBACKEND_DIR) && uv run uvicorn app:app --host $(HOST) --port $(PORT)

# Maintenance Tasks
install: install-node install-pybackend
	@echo "✅ Dependencies installed for Node.js workspaces and Python backend"

install-node:
	@echo "⚙️ Installing Node.js dependencies..."
	npm install

install-pybackend:
	@echo "⚙️ Syncing Python backend dependencies..."
	cd $(PYBACKEND_DIR) && uv sync

clean:
	@echo "🧹 Cleaning build artifacts and cache..."
	rm -rf node_modules
	rm -rf packages/*/node_modules
	rm -rf packages/pybackend/.venv
	rm -rf dist/
	rm -rf build/
	rm -rf *.egg-info/
	rm -rf packages/pybackend/*.egg-info/
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
	@echo "✅ Cleaned up build artifacts and cache"

# Docker Tasks
docker-build:
	@echo "🐳 Building Docker images..."
	docker compose build

docker-up: docker-build
	@echo "🚀 Starting all services with Docker Compose..."
	docker compose up -d
	@echo "✅ Services started:"
	@echo "  Frontend: http://localhost:8080"
	@echo "  Python API: http://localhost:3000/api/"
	@echo "  Node.js API: http://localhost:3001/api/"

docker-down:
	@echo "⏹️  Stopping Docker services..."
	docker compose down
	@echo "✅ All services stopped"

docker-dev:
	@echo "🔧 Starting development environment with hot reload..."
	docker compose up --build
	@echo "✅ Development environment started with hot reload"

docker-clean: docker-down
	@echo "🧹 Cleaning up Docker resources..."
	docker compose down -v --remove-orphans
	docker system prune -f
	@echo "✅ Docker cleanup completed"
