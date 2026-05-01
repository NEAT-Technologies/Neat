# Stub Dockerfile. Real multi-stage build with tree-sitter native deps lands later.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/types ./packages/types
COPY packages/core ./packages/core

RUN npm ci --workspaces --include-workspace-root
RUN npm run build --workspace @neat/core

ENV PORT=8080
EXPOSE 8080 4318

CMD ["node", "packages/core/dist/server.cjs"]
