# Generic neat-core image — no demo, no Railway-specific config.
#
# Mount your codebase at /workspace; neat will extract from there. Snapshots
# and the embeddings cache land in /neat-out — give that a volume if you want
# them to survive restarts.
#
# Default CMD runs the long-lived REST + OTLP receiver on :8080 / :4318.
# Override CMD with `neat init /workspace` for a one-shot snapshot, or
# `neat watch /workspace` for the live re-extraction daemon.

FROM node:20-bookworm-slim AS builder
WORKDIR /repo

# tree-sitter ships native prebuilds for the common platforms; keep the build
# chain available so a missing prebuild falls through to source build.
# @xenova/transformers (optional dep) is pure WASM, no native compile needed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/core/package.json packages/core/
COPY packages/mcp/package.json packages/mcp/
COPY packages/web/package.json packages/web/
COPY demo/service-a/package.json demo/service-a/
COPY demo/service-b/package.json demo/service-b/
RUN npm ci

COPY packages packages
RUN npx turbo run build --filter=@neat/core --filter=@neat/mcp

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Default scan + output locations. Mount over /workspace with -v $(pwd):/workspace
# to point neat at your repo; mount a volume at /neat-out to keep snapshots.
ENV NEAT_SCAN_PATH=/workspace
ENV NEAT_OUT_DIR=/neat-out
ENV NEAT_OUT_PATH=/neat-out/graph.json
ENV HOST=0.0.0.0
ENV PORT=8080
ENV OTEL_PORT=4318

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/types/dist ./packages/types/dist
COPY --from=builder /repo/packages/types/package.json ./packages/types/package.json
COPY --from=builder /repo/packages/core/dist ./packages/core/dist
COPY --from=builder /repo/packages/core/compat.json ./packages/core/compat.json
COPY --from=builder /repo/packages/core/proto ./packages/core/proto
COPY --from=builder /repo/packages/core/package.json ./packages/core/package.json
COPY --from=builder /repo/packages/mcp/dist ./packages/mcp/dist
COPY --from=builder /repo/packages/mcp/package.json ./packages/mcp/package.json

# Make the CLI reachable as `neat` and the MCP stdio binary as `neat-mcp` so
# `docker run ... neat init /workspace` and `docker run -i ... neat-mcp` work
# without remembering the dist paths.
RUN printf '#!/bin/sh\nexec node /app/packages/core/dist/cli.cjs "$@"\n' > /usr/local/bin/neat \
  && chmod +x /usr/local/bin/neat \
  && printf '#!/bin/sh\nexec node /app/packages/mcp/dist/index.cjs "$@"\n' > /usr/local/bin/neat-mcp \
  && chmod +x /usr/local/bin/neat-mcp

VOLUME ["/workspace", "/neat-out"]
EXPOSE 8080 4318

# Default to the long-lived daemon. Override with e.g.
#   docker run ... neat-core:0.1.2 neat watch /workspace
#   docker run ... neat-core:0.1.2 neat init /workspace --project a
CMD ["node", "/app/packages/core/dist/server.cjs"]
