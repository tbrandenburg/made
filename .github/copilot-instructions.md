# Copilot Instructions for MADE

## Project Overview

**MADE (Mobile Agentic Development Environment)** is a full-stack web application that provides developers with an integrated workspace for project management, knowledge organization, and AI-powered development assistance. The application consists of:

- **Frontend**: React + TypeScript + Vite (packages/frontend/) - Port 5173
- **Backend**: Python FastAPI (packages/pybackend/) - Port 3000
- **Architecture**: Monorepo with npm workspaces, using uv for Python dependency management

**Key Features**: Repository browsing, AI agent integration, knowledge base management, constitution system, integrated file editor, and mobile-optimized UI.

**Repository Structure**:
- `packages/frontend/` - React frontend with Vite build system
- `packages/pybackend/` - FastAPI backend with uv Python package management
- `tests/system/` - Playwright end-to-end tests
- `.github/workflows/` - CI/CD pipelines for testing and Docker builds
- `docker/` - Docker configurations for containerized deployment

## Build & Development Instructions

### Prerequisites
- **Node.js 18+** required for frontend
- **Python 3.10+** required for backend
- **uv** package manager for Python dependencies (auto-installed in CI)

### Essential Commands (ALWAYS use these)

**Installation** (run first):
```bash
make install  # Installs both frontend (npm ci) and backend (uv sync) dependencies
```

**Development** (start both services):
```bash
make run      # Starts backend on 0.0.0.0:3000 and frontend on 0.0.0.0:5173
```

**Quality Assurance** (run before committing):
```bash
make qa       # Runs format + lint + full test suite
make qa-quick # Runs format + lint + unit tests only (faster)
```

**Testing**:
```bash
make unit-test     # Frontend unit tests + Python backend unit tests with coverage
make system-test   # Playwright E2E tests (requires running services)
make test-coverage # Full test suite with detailed coverage (70% minimum)
```

**Maintenance**:
```bash
make stop     # Stop any running MADE services on ports 3000/5173
make restart  # Stop then start all services
make clean    # Clean build artifacts and cache
```

### Critical Build Notes

1. **ALWAYS run `make install` after dependency changes** - The project uses both npm workspaces and uv for dependency management.

2. **Python backend dependency issues**: If you see import errors for `fastapi` or `frontmatter`, ensure you're running tests with:
   ```bash
   cd packages/pybackend && uv sync && uv run pytest
   ```

3. **Service startup order**: Backend must start before frontend due to proxy configuration. `make run` handles this automatically.

4. **Port conflicts**: Run `make stop` before `make run` to avoid port conflicts on 3000/5173.

5. **System tests require running services**: The Playwright tests need both frontend and backend running. Use `make system-test` which handles this automatically.

## CI/CD & Validation Pipeline

**GitHub Workflows**:
- `tests.yml` - Runs QA, coverage tests, and system tests
- `docker.yml` - Builds and tests Docker containers
- `nodejs-frontend-preview.yml` - Deploys frontend previews

**Validation Steps** (replicated in CI):
1. `make install` - Install dependencies
2. `make qa-quick` - Quick quality checks (lint, format, unit tests)
3. `make test-coverage` - Backend tests with 70% coverage requirement
4. `make system-test` - End-to-end Playwright tests
5. `make docker-build && make docker-up` - Container validation

**Common CI Failures & Solutions**:
- **Import errors in Python tests**: Use `uv run` or ensure dependencies installed with `uv sync`
- **Frontend build failures**: Check for TypeScript errors with `npm run lint`
- **System test timeouts**: Services need 60s to start; wait-on is used in CI
- **Coverage failures**: Minimum 70% backend coverage required

## Project Layout & Architecture

### Configuration Files
- `Makefile` - Primary build automation (USE THIS for all operations)
- `package.json` - Root npm workspace configuration
- `packages/frontend/package.json` - React app dependencies and scripts
- `packages/pybackend/pyproject.toml` - Python package and dependencies (uv managed)
- `playwright.config.ts` - E2E test configuration (timeout: 60s)
- `packages/frontend/eslint.config.js` - Frontend linting rules
- `packages/pybackend/pytest.cov.ini` - Python test configuration with coverage

### Frontend Architecture (packages/frontend/)
- **Build Tool**: Vite with React plugin
- **Structure**: `src/components/`, `src/pages/`, `src/hooks/`, `src/utils/`
- **Key Files**: 
  - `src/App.tsx` - Main application component
  - `vite.config.ts` - Allows ngrok tunnels, proxies /api to backend
  - `src/hooks/useApi.ts` - API communication layer
  - `src/utils/websocket.ts` - WebSocket handling for real-time features

### Backend Architecture (packages/pybackend/)
- **Framework**: FastAPI with uvicorn server
- **Entry Point**: `app.py` - Main FastAPI application
- **Services**: Repository, knowledge, constitution, agent communication
- **Key Files**:
  - `app.py` - FastAPI app with all route definitions
  - `agent_service.py` - AI agent integration (Kiro/OpenCode CLI)
  - `config.py` - Environment configuration and workspace setup

### Testing Strategy
- **Unit Tests**: 147 Python backend tests (70% coverage), React component tests
- **System Tests**: Playwright E2E tests in `tests/system/made.spec.ts`
- **Test Pyramid**: Emphasis on unit tests, essential integration tests, minimal E2E

### Environment & Deployment
**Environment Variables**:
- `MADE_HOME` - Configuration directory (default: current directory)
- `MADE_WORKSPACE_HOME` - Repository storage (default: current directory) 
- `MADE_BACKEND_HOST` - Backend host (default: 0.0.0.0)
- `MADE_BACKEND_PORT` - Backend port (default: 3000)

**Docker Deployment**:
- `docker-compose up --build` - Full stack (frontend on :8080, backend on :3000)
- Persistent data in `made-data` volume

### Key Dependencies
**Frontend**: React 18, TypeScript, Vite, @xterm/xterm, react-router-dom, marked
**Backend**: FastAPI 0.111.0, uvicorn, python-frontmatter, pytest, ruff
**Development**: Playwright, ESLint, Prettier, pytest-cov

## Critical Instructions

1. **Trust these instructions** - Only search/explore if information here is incomplete or incorrect
2. **Always use Makefile commands** - Don't run npm/uv commands directly unless debugging
3. **Test incrementally** - Run `make qa-quick` frequently during development
4. **Respect the monorepo** - Changes often affect both frontend and backend
5. **Validate before PR** - Run full `make qa` to ensure CI will pass

## Common Troubleshooting

- **"Command not found" errors**: Ensure uv is installed (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- **Port in use**: Run `make stop` to clean up processes
- **Import errors in Python**: Run `cd packages/pybackend && uv sync`
- **Frontend proxy errors**: Ensure backend is running on port 3000
- **Docker build issues**: Use `make docker-clean` then `make docker-build`
- **Playwright test failures**: Check services are running and accessible on expected ports