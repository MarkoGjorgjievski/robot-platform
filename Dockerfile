# syntax=docker/dockerfile:1
# The whole stack in Docker Compose (spec docs/superpowers/specs/2026-10-23-docker-compose-design.md).
# One file, three images: `api` (api-server; also runs the migrations), `worker` (@robot/worker with
# Playwright's Chromium), `app` (the built @robot/app). Each installs only its own package and what it
# depends on (`pnpm install --filter <pkg>...`), with pnpm pinned by package.json's packageManager (corepack).
# The workspace packages export TypeScript source, so api-server and worker run it with tsx, as in dev.

ARG NODE_IMAGE=node:22-bookworm-slim
# Must match the playwright-core that launches Chromium: @robot/browser launches through playwright-extra
# (stealth, on by default), which resolves playwright-core 1.62.1 in pnpm-lock.yaml, not @robot/browser's own
# playwright 1.58.2. A mismatch fails every launch with "Executable doesn't exist at /ms-playwright/...".
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.62.1-noble

# ── shared: corepack + the workspace manifests (the install layer is cached until one of these changes) ──
FROM ${NODE_IMAGE} AS node-base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1
RUN corepack enable
WORKDIR /repo

FROM node-base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/agent/package.json packages/agent/
COPY packages/api/package.json packages/api/
COPY packages/api-server/package.json packages/api-server/
COPY packages/app/package.json packages/app/
COPY packages/browser/package.json packages/browser/
COPY packages/db/package.json packages/db/
COPY packages/scraper/package.json packages/scraper/
COPY packages/worker/package.json packages/worker/

# ── api: the api-server (and drizzle-kit for the one-shot migrate service) ──
FROM manifests AS api
RUN --mount=type=cache,id=robot-stack-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@robot/api-server..."
COPY packages ./packages
ENV CAPTURES_DIR=/repo/packages/api-server/public/captures PORT=4000
RUN mkdir -p "$CAPTURES_DIR"
WORKDIR /repo/packages/api-server
EXPOSE 4000
CMD ["node_modules/.bin/tsx", "src/index.ts"]

# ── worker: Playwright's own image (Chromium and its system libraries at the version the lockfile pins) ──
FROM ${PLAYWRIGHT_IMAGE} AS worker
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1
RUN corepack enable
WORKDIR /repo
COPY --from=manifests /repo /repo
RUN --mount=type=cache,id=robot-stack-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@robot/worker..."
COPY packages ./packages
ENV CAPTURES_DIR=/repo/packages/api-server/public/captures
RUN mkdir -p "$CAPTURES_DIR"
WORKDIR /repo/packages/worker
CMD ["node_modules/.bin/tsx", "src/index.ts"]

# ── app: build with the api-server's address as the browser will see it, then serve dist/ ──
FROM manifests AS app-build
RUN --mount=type=cache,id=robot-stack-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@robot/app..."
COPY packages ./packages
ARG VITE_API_URL=http://127.0.0.1:4200
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm --filter @robot/app build

FROM manifests AS app
# Runtime dependencies only: the SSR bundle imports react, the router, tRPC and friends from node_modules.
RUN --mount=type=cache,id=robot-stack-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --filter "@robot/app"
COPY --from=app-build /repo/packages/app/dist packages/app/dist
COPY packages/app/serve.mjs packages/app/serve.mjs
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /repo/packages/app
EXPOSE 3000
CMD ["node", "serve.mjs"]
