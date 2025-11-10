# syntax=docker/dockerfile:1
FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace manifests first to leverage Docker layer caching
COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/package.json

# Install only the backend workspace dependencies
RUN npm ci --omit=dev --workspace packages/backend --include-workspace-root=false \
  && npm cache clean --force

# Copy backend source code
COPY packages/backend packages/backend

EXPOSE 3000

CMD ["node", "packages/backend/src/server.js"]
