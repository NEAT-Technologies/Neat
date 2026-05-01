# Multi-stage build: full workspace install + tsup build, then a slim runtime
# image with just dist + the prod-resolved node_modules.
#
# Build context is the repo root, not packages/core. Set in docker-compose.yml.

FROM node:20-bookworm-slim AS builder
WORKDIR /repo

# tree-sitter ships native bindings with prebuilds for common platforms, but
# keep the build chain available so a missing prebuild falls back to source.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install workspace deps first so they cache across source changes.
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/core/package.json packages/core/
COPY packages/mcp/package.json packages/mcp/
COPY packages/web/package.json packages/web/
COPY demo/service-a/package.json demo/service-a/
COPY demo/service-b/package.json demo/service-b/
RUN npm ci

COPY packages packages
RUN npx turbo run build --filter=@neat/core

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Bring across the resolved node_modules (root + per-package symlinks) and the
# core dist + sibling packages. tsup leaves @neat/types as an external require,
# so we need its dist available at runtime.
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/types/dist ./packages/types/dist
COPY --from=builder /repo/packages/types/package.json ./packages/types/package.json
COPY --from=builder /repo/packages/core/dist ./packages/core/dist
COPY --from=builder /repo/packages/core/compat.json ./packages/core/compat.json
COPY --from=builder /repo/packages/core/package.json ./packages/core/package.json

EXPOSE 8080 4318

CMD ["node", "packages/core/dist/server.cjs"]
