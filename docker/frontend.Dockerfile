# syntax=docker/dockerfile:1
FROM node:18-alpine AS build

WORKDIR /app

# Install dependencies for the frontend workspace
COPY package.json package-lock.json ./
COPY packages/frontend/package.json packages/frontend/package.json
RUN npm ci --workspace packages/frontend --include-workspace-root=false \
  && npm cache clean --force

# Copy frontend source and build the production bundle
COPY packages/frontend packages/frontend

# Fix for npm/rollup issue with optional dependencies in Alpine
# Remove lock file and node_modules, then reinstall to resolve rollup native module issue
RUN rm -rf node_modules package-lock.json && \
    npm install --workspace packages/frontend --include-workspace-root=false && \
    npm run build --workspace packages/frontend

FROM nginx:1.27-alpine

# Copy custom Nginx configuration to route API calls to the backend service
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built frontend assets
COPY --from=build /app/packages/frontend/dist /usr/share/nginx/html

EXPOSE 80
