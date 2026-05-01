# Stub Dockerfile. Real multi-stage build with tree-sitter native deps lands later.
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/types ./packages/types
COPY packages/core ./packages/core

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @neat/core build

ENV PORT=8080
EXPOSE 8080 4318

CMD ["node", "packages/core/dist/server.cjs"]
