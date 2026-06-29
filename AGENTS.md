# AGENTS.md

## Purpose
This file provides guidance for Codex Cloud (an agent in the cloud) on how to correctly build, run, and preview this Python/React application.

## Project Information

* packages/pybackend/: Python backend (FastAPI)
* packages/frontend/: NodeJS frontend (React + Vite)

## Constitution and guidelines

### Mandatory constitution

These rules overwrite all other rules, even in case of conflict with the experts:

- Follow KISS principle - do not overengineer. Simplicity stays and wins!
- Follow DRY principle - do not repeat yourself and structure code modularly
- Always test the main or user-facing functionality: keep tests simple, high-value, and maintainable — prefer acceptance/system tests over microtests, avoid overtesting, and follow the Testing Pyramid and KISS principles
- **NEVER shutdown or interrupt development servers running on standard ports (3000, 5173) when working within the made workspace** — these are critical for the development workflow

### General Guidelines

These are rules which should guide you, but can be overwritten by experts or programming language specifics:

- Write markdown file stem names in capital letters like README.md or MY_EXPLANATION.md
- Whenever you can not test because of technical reasons, review much deeper instead by performing additional web searches for getting latest specifications and examples until the solution meets state-of-the-art and common understanding
- Make web apps experienceable by running them (e.g. `npm run dev` or `uv run ...`)

### Testing guideline

This guide outlines the minimal test levels absolutely required for **Python FastAPI** backend and **React** frontend.
Follow this mandatory guideline even if not instructed.
Focus on lightweight, fast feedback — only essential tests are included.
- Before pushing changes, run `make qa-quick` from repository root and address any failures.
- For faster feedback during development, use scoped targets:
  - `make test-frontend FILE=src/path/to/file.test.tsx [NAME=pattern]` — run a single frontend test file
  - `make test-backend FILE=tests/unit/test_foo.py [NAME=pattern]` — run a single backend test file
  - `make qa-quick-frontend` — lint + frontend tests only
  - `make qa-quick-backend` — ruff + backend unit tests only
  - `make qa-quick-changed` — auto-detects changed package and runs only that package's QA

### Pre-push quality gate (mandatory)

A git `pre-push` hook is stored in `scripts/hooks/pre-push` and installed by `make install`.
It runs `make qa-quick` (lint + format + unit-test) automatically before every `git push`.

- **Never bypass this hook** (`--no-verify`) unless CI is explicitly broken and you are pushing a hotfix.
- If the hook is missing after a fresh clone, run `make install` or `make install-hooks` to restore it.
- When adding new linting rules, ensure they pass locally via `make lint` before committing.

### CI/CD Note for Backend Pytest
- If CI runs `python -m pytest packages/pybackend/tests/unit` directly, install backend dependencies first (e.g., `cd packages/pybackend && uv sync` or `python -m pip install -e packages/pybackend`) to avoid missing-import collection errors.
- If CI runs `python -m pytest` outside the `uv` environment, dependencies like `fastapi` can be missing. Prefer running tests with `uv run` (for example: `uv run --project packages/pybackend python -m pytest packages/pybackend/tests/unit`) or activate the `.venv` created by `uv sync` before executing pytest.

### ⚙️ Frontend Testing Checklist
- [ ] **Unit Tests** — Cover core React components and utilities.
- [ ] **Integration Tests** — Check that essential API calls work.
- [ ] **System Tests** — Test main user flows with Playwright
- [ ] **Smoke Tests** — Confirm app starts

### 🐳 Dockerized Testing Checklist
*Note: Use these tests only if you plan to containerize the application with Docker.*
- [ ] **Component Tests** — Ensure each container builds and starts without errors.  
- [ ] **Smoke Tests** — Run full stack with `docker-compose up --build -d`.  
- [ ] **Smoke Tests** — Verify containers are healthy (`docker ps` or `docker-compose ps`).  
- [ ] **Smoke Tests** — Check main endpoints respond (`curl http://localhost:3000/health`).  
- [ ] **Smoke Tests** — Stop stack cleanly with `docker-compose down`.

## Environment Setup
- Use **Python 3.12 or newer** for the backend.
- Use **Node.js 18 or newer** for the frontend.
- Run `npm install` to install frontend dependencies.
- Run `cd packages/pybackend && uv sync` to install backend dependencies.
- **Run `make install` (preferred) — installs all dependencies AND sets up the pre-push git hook.**
- Ensure the environment variable `PORT` is respected (default: `3000`).
- The app must listen on `0.0.0.0` (not `localhost`) to enable public preview.
- The vite configuration has to be set up for allowing following remote hosts for previews (allowedHosts): .ngrok-free.dev, .ngrok.io, .ngrok.app

## Build & Run Instructions
1. **Install dependencies**
   ```bash
   # Install all dependencies and git hooks (recommended)
   make install

   # Or manually:
   # Frontend dependencies
   npm install
   
   # Backend dependencies  
   cd packages/pybackend && uv sync
   ```

2. **Start the servers**
   ```bash
   # Start both services (recommended)
   make run
   
   # Or start individually:
   # Backend: cd packages/pybackend && uv run uvicorn app:app --host 0.0.0.0 --port 3000
   # Frontend: npm run dev:frontend
   ```

3. **Confirm the servers are ready**
   The backend should log:
   ```
   INFO: Uvicorn running on http://0.0.0.0:3000
   ```
   The frontend should log:
   ```
    Local: https://localhost:5173/
   ```
   This signals that the preview is ready to be exposed.

## Preview Configuration
- The preview must expose **port 3000**.
- Wait for the app to start successfully before generating the preview link.
- If preview generation fails, print logs to diagnose issues (e.g., build errors or port conflicts).

## Troubleshooting
- Ensure Python 3.12+ is installed for the backend.
- Ensure Node.js dependencies are properly declared in `packages/frontend/package.json`.
- Ensure Python dependencies are properly declared in `packages/pybackend/pyproject.toml`.
- Avoid interactive prompts during startup commands.
- For Python backend issues, check that `uv` is installed and `packages/pybackend/.venv` exists.
- For frontend production mode:
  ```bash
  npm run build:frontend && npm run preview:frontend
  ```

## Notes
- Codex Cloud sandboxes may time out; ensure startup completes promptly.
- Keep build output small and dependencies clean to reduce setup time.
- Always test locally before expecting preview success.

## Lessons Learned

- 2026-06-29: `_processing_channels` cleanup in `agent_service.py` is deferred to polling — any code path that skips polling can leave stale lock keys. Prevention: always verify cleanup happens on the write path (success path of `send_agent_message`), not only on the read path (`get_channel_status`). When adding new async state, ask "what cleans this up if the reader never arrives?"
- 2026-06-29: In parallel subagent workflows, group all changes to a single high-contention file (e.g. `agent_service.py`) under one subagent. Splitting them across agents on the same branch always risks merge conflicts. Frontend and backend can safely run in parallel as they share no files.
- 2026-06-29: When frontend error detection relies on HTTP status codes, ensure the API layer actually preserves and exposes them. A plain `throw new Error(body)` discards status; a typed `HttpError` with a `status` field is the correct pattern.
- 2026-06-29: PID-alive is not the same as agent-busy. For persistent session processes (e.g. opencode run -s <session>), the process stays alive between messages. The channel lock must be released on the success path of `send_agent_message`, not deferred to polling. Rule: every code path that acquires a lock must release it — success, error, and cancel.
- 2026-06-29: Status endpoints must not infer request state from OS process existence. Heuristic fallbacks (ps scan, registry-only PID check) that re-populate lock state on every poll cause perpetual false-busy. The explicit in-memory lock is the single source of truth; startup initialization handles crash recovery. Never add "last resort" OS inference to a status check.
