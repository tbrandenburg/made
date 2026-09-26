# syntax=docker/dockerfile:1
FROM node:22.14-bookworm-slim AS opencode
RUN npm install --global @opencode/cli@2.0.18

FROM python:3.12-slim

ARG COMMIT_SHA=unknown
ARG BUILD_DATE=unknown

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=opencode /usr/local/bin/node /usr/local/bin/node
COPY --from=opencode /usr/local/bin/opencode /usr/local/bin/opencode
COPY --from=opencode /usr/local/lib/node_modules /usr/local/lib/node_modules

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
COPY packages/pybackend/pyproject.toml packages/pybackend/uv.lock ./
RUN uv sync --frozen --no-install-project

COPY packages/pybackend/ ./
RUN uv sync --frozen && mkdir -p /workspace /opencode-data

ENV PATH="/usr/local/bin:${PATH}"
ENV PYTHONPATH=/app
ENV PORT=3000
ENV MADE_WORKSPACE_HOME=/workspace
ENV COMMIT_SHA=${COMMIT_SHA}
ENV BUILD_DATE=${BUILD_DATE}

EXPOSE 3000
CMD [".venv/bin/uvicorn", "app:app", "--host", "0.0.0.0", "--port", "3000"]
