# MADE Makefile
# Provides common development tasks for the MADE project

PORT ?= 3000
HOST ?= 0.0.0.0
PYBACKEND_DIR := packages/pybackend

.PHONY: help lint format test unit-test system-test qa qa-quick build run clean install install-node install-pybackend

# Default target
help:
@echo "MADE Development Tasks"
@echo "======================"
@echo ""
@echo "Quality Assurance:"
@echo "  format      Format frontend code"
@echo "  lint        Run frontend linter"
@echo "  test        Run all tests"
@echo "  unit-test   Run unit tests only"
@echo "  system-test Run system tests only"
@echo "  qa          Run all quality assurance tasks (lint + format + test)"
@echo "  qa-quick    Run all quick quality assurance tasks (lint + format + unit-test)"
@echo ""
@echo "Build & Run:"
@echo "  build     Build the project"
@echo "  run       Start the Python backend with uvicorn"
@echo ""
@echo "Maintenance:"
@echo "  install   Install/sync dependencies"
@echo "  clean     Clean build artifacts and cache"
@echo ""
@echo "Example usage:"
@echo "  make qa                        # Run all quality checks"
@echo "  make run PORT=3000             # Start the Python backend"

# Quality Assurance Tasks
format:
@echo "🎨 Formatting frontend code..."
npm run format

lint:
@echo "🔍 Running linter..."
npm run lint

test:
@echo "🧪 Running all tests..."
npm test

unit-test:
@echo "🔬 Running unit tests..."
npm test

system-test:
@echo "🏗️ Running system tests..."
npm run test:e2e

qa: format lint test
@echo "✅ All quality assurance tasks completed successfully!"

qa-quick: format lint unit-test
@echo "✅ All quick quality assurance tasks completed successfully!"

# Build & Run Tasks
build:
@echo "📦 Building the project..."
npm run build

run:
@echo "🚀 Starting MADE Python backend on $(HOST):$(PORT)..."
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
