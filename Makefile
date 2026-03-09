# MADE Makefile
# Provides common development tasks for the MADE project

PORT ?= 3000
FRONTEND_PORT ?= 5173
HOST ?= 0.0.0.0
PYBACKEND_DIR := packages/pybackend
MADE_HOME ?= $(abspath $(CURDIR)/workspace/)
MADE_WORKSPACE_HOME ?= $(abspath $(CURDIR)/workspace/)

export MADE_HOME
export MADE_WORKSPACE_HOME

.PHONY: help lint format test unit-test system-test qa qa-quick build run stop restart clean install install-node install-pybackend test-coverage security-audit docker-build docker-up docker-down docker-dev docker-clean

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
	@echo "  test-coverage Run full test suite with coverage reporting (70% minimum)"
	@echo "  security-audit Run npm security audit to check for vulnerabilities"
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
	@echo "  stop      Stop any running MADE services"
	@echo "  restart   Stop and then start all services"
	@echo ""
	@echo "Maintenance:"
	@echo "  install   Install/sync dependencies"
	@echo "  clean     Clean build artifacts and cache"
	@echo ""
	@echo "Example usage:"
	@echo "  make qa                        # Run all quality checks"
	@echo "  make test-coverage             # Run backend tests with detailed coverage"
	@echo "  make stop                      # Stop running services before starting new ones"
	@echo "  make run                       # Start services (auto-stops conflicting processes)"
	@echo "  make restart                   # Stop and restart all services"
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
	cd $(PYBACKEND_DIR) && uv sync && uv run pytest -c pytest.cov.ini

unit-test:
	@echo "🔬 Running frontend unit tests..."
	npm test
	@echo "🔬 Running backend unit tests with coverage..."
	cd $(PYBACKEND_DIR) && uv sync && uv run pytest -c pytest.cov.ini tests/unit/

system-test:
	@echo "🏗️ Running system tests with service management..."
	@echo "🚀 Starting services for system tests..."
	@echo "🔍 Checking port availability..."
	@lsof -ti:5173 >/dev/null 2>&1 && echo "⚠️ Port 5173 still in use" || echo "✅ Port 5173 available"
	@lsof -ti:3000 >/dev/null 2>&1 && echo "⚠️ Port 3000 still in use" || echo "✅ Port 3000 available"
	@echo "✅ Ports are available"
	@MADE_HOME=$(MADE_HOME) MADE_WORKSPACE_HOME=$(MADE_WORKSPACE_HOME) npm --workspace packages/frontend run dev -- --host 127.0.0.1 --port 5173 > frontend-test.log 2>&1 & \
	FRONTEND_PID=$$!; \
	cd $(PYBACKEND_DIR) && MADE_HOME=$(MADE_HOME) MADE_WORKSPACE_HOME=$(MADE_WORKSPACE_HOME) MADE_BACKEND_HOST=127.0.0.1 MADE_BACKEND_PORT=3000 uv run made-backend > ../backend-test.log 2>&1 & \
	BACKEND_PID=$$!; \
	trap 'echo "🛑 Stopping test services..."; kill $$FRONTEND_PID $$BACKEND_PID 2>/dev/null || true; wait' EXIT INT TERM; \
	echo "⏳ Waiting for services to be ready..."; \
	npx wait-on http://127.0.0.1:5173 http://127.0.0.1:3000/api/repositories --timeout 120000 --interval 2000; \
	echo "✅ Services are ready"; \
	echo "⏳ Allowing services to stabilize..."; \
	sleep 3; \
	echo "🔍 Verifying services are still running..."; \
	curl -s http://127.0.0.1:5173 > /dev/null && echo "✅ Frontend still responsive" || echo "❌ Frontend not responding"; \
	curl -s http://127.0.0.1:3000/api/repositories > /dev/null && echo "✅ Backend still responsive" || echo "❌ Backend not responding"; \
	echo "🔬 Running frontend system tests..."; \
	npm run test:e2e; \
	TEST_EXIT_CODE=$$?; \
	echo "🔬 Running backend system tests..."; \
	cd $(PYBACKEND_DIR) && uv sync && uv run pytest tests/system/ -v; \
	BACKEND_TEST_EXIT_CODE=$$?; \
	if [ $$TEST_EXIT_CODE -ne 0 ] || [ $$BACKEND_TEST_EXIT_CODE -ne 0 ]; then \
	echo "❌ Some system tests failed"; \
	exit 1; \
	fi; \
	echo "✅ All system tests passed"

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
	cd $(PYBACKEND_DIR) && uv sync && uv run pytest -c pytest.cov.ini --cov-branch --cov-fail-under=70
	@echo "📊 Coverage report generated in packages/pybackend/htmlcov/"

# Security Tasks
security-audit:
	@echo "🔒 Running npm security audit..."
	@echo "🔍 Checking root dependencies..."
	npm audit --audit-level moderate
	@echo "🔍 Checking frontend dependencies..."
	cd packages/frontend && npm audit --audit-level moderate
	@echo "📋 Security audit completed"

# Build & Run Tasks
build:
	@echo "📦 Building frontend..."
	npm run build
	@echo "📦 Building backend package..."
	cd $(PYBACKEND_DIR) && uv build

run: install stop
	        @echo "🚀 Starting MADE services..."
	        @echo "  📡 Python backend will start on $(HOST):$(PORT)"
	        @echo "  🖥️  Frontend will start on $(HOST):$(FRONTEND_PORT)"
	        @echo "  📋 Press Ctrl+C to stop both services."
	        @echo ""
	        @echo "🔧 Setting up workspace environment..."
	        @echo "  📁 MADE_HOME: $(MADE_HOME)"
	        @echo "  📁 MADE_WORKSPACE_HOME: $(MADE_WORKSPACE_HOME)"
	        @echo ""
	        @echo "🔧 Starting Python backend..."
	        @cd $(PYBACKEND_DIR) && MADE_HOME=$(MADE_HOME) MADE_WORKSPACE_HOME=$(MADE_WORKSPACE_HOME) MADE_BACKEND_HOST=$(HOST) MADE_BACKEND_PORT=$(PORT) uv run made-backend & \
	        BACKEND_PID=$$!; \
	        sleep 2; \
	        echo "✅ Backend started (PID $$BACKEND_PID)"; \
	        echo "🔧 Starting frontend..."; \
	cleanup() { \
		if [ "$$CLEANUP_DONE" != "1" ]; then \
			export CLEANUP_DONE=1; \
			echo ""; \
			echo "⏹️  Stopping services..."; \
			echo "  🛑 Stopping backend (PID $$BACKEND_PID)..."; \
			kill $$BACKEND_PID 2>/dev/null || true; \
			echo "  🛑 Stopping frontend..."; \
			sleep 1; \
			echo "✅ All services stopped"; \
		fi; \
	}; \
	trap cleanup EXIT INT TERM; \
	npm --workspace packages/frontend run dev -- --host $(HOST) --port $(FRONTEND_PORT)

# Stop running services
stop:
	@echo "🛑 Stopping any running MADE services..."
	@echo "🔍 Looking for processes on port $(PORT)..."
	-@lsof -ti:$(PORT) | xargs -r kill -9 2>/dev/null || true
	@echo "🔍 Looking for processes on port $(FRONTEND_PORT)..."
	-@lsof -ti:$(FRONTEND_PORT) | xargs -r kill -9 2>/dev/null || true
	@echo "✅ Service cleanup completed"

# Restart services (stop then start)
restart: stop run

# Maintenance Tasks
install: install-node install-pybackend
	@echo "✅ Dependencies installed for frontend and Python backend"

install-node:
	@echo "⚙️ Installing Node.js dependencies..."
	npm ci
	@echo "✅ Node.js dependencies installed"

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
