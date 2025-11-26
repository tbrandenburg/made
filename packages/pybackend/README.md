# MADE Python Backend

A FastAPI implementation of the MADE backend that mirrors the Node.js API exposed under the `/api` prefix. It reuses the same filesystem layout and environment variables so it can run side by side with the existing service.

## Run locally
1. Install dependencies with [uv](https://docs.astral.sh/uv/):
   ```bash
   cd packages/pybackend
   uv sync
   ```
2. Start the server (default port `3000`):
   ```bash
   uv run uvicorn app:app --host 0.0.0.0 --port 3000
   ```

## Configuration
- `MADE_HOME` – overrides the home directory where `.made` is stored (defaults to the current working directory).
- `MADE_WORKSPACE_HOME` – overrides the workspace directory scanned for repositories (defaults to the current working directory).

The endpoints, payloads, and responses are intentionally kept identical to the Node backend so the frontend can switch between them without changes.
