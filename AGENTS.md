# AGENTS.md

## Purpose
This file provides guidance for Codex Cloud (an agent in the cloud) on how to correctly build, run, and preview this Node.js application.

## Project Information

* packages/backend/: NodeJS backend
* packages/frontend/: NodeJS frontend

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

This guide outlines the minimal test levels absolutely required for **Node.js** and **Docker**.
Follow this mandatory guideline even if not instructed.
Focus on lightweight, fast feedback — only essential tests are included.

### ⚙️ Node.js Testing Checklist
- [ ] **Unit Tests** — Cover core business logic with `Jest`.  
- [ ] **Integration Tests** — Check that essential routes and DB/API calls work.  
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
- Use **Node.js 18 or newer**.
- Run `npm install` to install all dependencies.
- Ensure the environment variable `PORT` is respected (default: `3000`).
- The app must listen on `0.0.0.0` (not `localhost`) to enable public preview.
- The vite configuration has to be set up for allowing following remote hosts for previews (allowedHosts): .ngrok-free.dev, .ngrok.io, .ngrok.app

## Build & Run Instructions
1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Build the project** (if applicable)
   ```bash
   npm run build
   ```

3. **Start the server**
   ```bash
   npm run dev
   ```

4. **Confirm the server is ready**
   The server should log a message similar to:
   ```
   Server listening on port 3000
   ```
   This signals that the preview is ready to be exposed.

## Preview Configuration
- The preview must expose **port 3000**.
- Wait for the app to start successfully before generating the preview link.
- If preview generation fails, print logs to diagnose issues (e.g., build errors or port conflicts).

## Troubleshooting
- Ensure all dependencies are properly declared in `package.json`.
- Avoid interactive prompts during `npm run` commands.
- For frameworks like **Next.js**, use production mode:
  ```bash
  npm run build && npm run start
  ```
- For **Express** or similar custom servers, ensure your `server.js` includes:
  ```js
  const express = require('express');
  const app = express();
  const PORT = process.env.PORT || 3000;
  const HOST = '0.0.0.0';
  app.listen(PORT, HOST, () => console.log(`Server listening on http://${HOST}:${PORT}`));
  ```

## Notes
- Codex Cloud sandboxes may time out; ensure startup completes promptly.
- Keep build output small and dependencies clean to reduce setup time.
- Always test locally before expecting preview success.
