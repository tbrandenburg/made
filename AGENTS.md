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

### General Guidelines

These are rules which should guide you, but can be overwritten by experts or programming language specifics:

- Write markdown file stem names in capital letters like README.md or MY_EXPLANATION.md
- Whenever you can not test because of technical reasons, review much deeper instead by performing additional web searches for getting latest specifications and examples until the solution meets state-of-the-art and common understanding
- Make web apps experienceable by running them (e.g. `npm run dev` or `uv run ...`)

### Testing guideline

This guide outlines the minimal test levels absolutely required for **Python FastAPI** backend and **React** frontend.
Follow this mandatory guideline even if not instructed.
Focus on lightweight, fast feedback — only essential tests are included.

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
- Ensure the environment variable `PORT` is respected (default: `3000`).
- The app must listen on `0.0.0.0` (not `localhost`) to enable public preview.
- The vite configuration has to be set up for allowing following remote hosts for previews (allowedHosts): .ngrok-free.dev, .ngrok.io, .ngrok.app

## Build & Run Instructions
1. **Install dependencies**
   ```bash
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
   Local: http://localhost:5173/
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
