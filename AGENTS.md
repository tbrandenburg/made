# AGENTS.md

## Purpose
This file provides guidance for Codex Cloud on how to correctly build, run, and preview this Node.js application.

## Environment Setup
- Use **Node.js 18 or newer**.
- Run `npm install` to install all dependencies.
- Ensure the environment variable `PORT` is respected (default: `3000`).
- The app must listen on `0.0.0.0` (not `localhost`) to enable public preview.
- The vite configuration has to allow those remote hosts: .ngrok-free.dev, .ngrok.io, .ngrok.app


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
   npm run start
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
