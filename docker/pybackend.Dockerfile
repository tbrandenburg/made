# syntax=docker/dockerfile:1
FROM python:3.12-slim

ARG COMMIT_SHA=unknown
ARG BUILD_DATE=unknown

WORKDIR /app

# Install system dependencies required at runtime (git for repository operations,
# curl to install the OpenCode agent CLI)
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install the OpenCode 2 agent CLI (used by agent_cli.py to run agent chat sessions).
# OpenCode 2 runs sessions on a shared background service, so a message sent
# while the agent is working is handled by the service instead of a second
# independent process. The OpenCode 1 installer (opencode.ai/install) does not.
ARG OPENCODE_VERSION=2.4.1
RUN curl -fsSL https://opencode.ai/v2/install | bash -s -- --version ${OPENCODE_VERSION}
ENV PATH="/root/.opencode/bin:${PATH}"

# Install UV package manager
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Copy pyproject.toml and uv.lock first for better caching
COPY packages/pybackend/pyproject.toml packages/pybackend/uv.lock ./

# Install dependencies only (no local package) - cached while source is unchanged
RUN uv sync --frozen --no-install-project

# Copy source code
COPY packages/pybackend/ ./

# Install the local package now that source is present
RUN uv sync --frozen

# Default to the OpenCode 2 adapter to match the CLI installed above. A fresh
# made-data volume is initialised from this file; existing volumes keep their
# own settings.
RUN mkdir -p /app/.made && printf '{\n  "agentCli": "opencode-v2"\n}\n' > /app/.made/settings.json

# Dedicated workspace directory for user repositories, separate from the
# backend's own source/build artifacts living in /app
RUN mkdir -p /workspace

# Expose the port the app runs on
EXPOSE 3000

# Set environment variables
ENV PYTHONPATH=/app
ENV PORT=3000
ENV MADE_WORKSPACE_HOME=/workspace
ENV COMMIT_SHA=${COMMIT_SHA}
ENV BUILD_DATE=${BUILD_DATE}

# Run the application
CMD [".venv/bin/uvicorn", "app:app", "--host", "0.0.0.0", "--port", "3000"]