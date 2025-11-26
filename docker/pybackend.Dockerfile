# syntax=docker/dockerfile:1
FROM python:3.12-slim

WORKDIR /app

# Install UV package manager
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Copy pyproject.toml and uv.lock first for better caching
COPY packages/pybackend/pyproject.toml packages/pybackend/uv.lock ./

# Install dependencies only (no local package)
RUN uv venv && uv pip install fastapi==0.111.0 python-frontmatter==1.0.0 uvicorn==0.29.0

# Copy source code
COPY packages/pybackend/ ./

# Expose the port the app runs on
EXPOSE 3000

# Set environment variables
ENV PYTHONPATH=/app
ENV PORT=3000

# Run the application
CMD [".venv/bin/uvicorn", "app:app", "--host", "0.0.0.0", "--port", "3000"]