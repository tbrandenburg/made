# MADE Python Backend

A FastAPI implementation of the MADE backend, providing a modern Python-based API for the frontend. It uses the same filesystem layout and environment variables for seamless integration.

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

The endpoints, payloads, and responses provide a clean REST API for the frontend to interact with the backend services.

## CI/CD

When running tests directly in CI/CD (for example, `python -m pytest packages/pybackend/tests/unit`), install backend dependencies first to avoid import errors for `fastapi` or `frontmatter`:

```bash
# Option A: use uv (recommended)
cd packages/pybackend
uv sync

# Option B: use pip
python -m pip install -e packages/pybackend
```
