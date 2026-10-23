# The whole stack in Docker Compose — design

**Status:** written 2026-10-23 under the standing approval (`CLAUDE.md`, "Autonomous runs"; queue item 1,
`docs/queue.md`). Plan: `docs/superpowers/plans/2026-10-23-docker-compose.md`. Branch `feat/docker-compose`
from `main` @ `6d83b1b`, worktree `C:\Users\Marko\Documents\projects\robot-platform-compose`.

## 1. Goal

`docker compose up` starts the app, the api-server, the capture worker and Postgres from one command, on a
machine with nothing but Docker; a nightly `pg_dump` writes to `./backups`; a restore test proves a dump comes
back whole. *Done when:* the app serves end to end locally, and the restore test passes.

## 2. Constraints

- **Never touches the dev setup.** Compose project `robot-stack` (pinned by `name:` in the file), its own volumes
  (`robot-stack_pgdata`, `robot-stack_captures`), its own host ports, bound to loopback only (127.0.0.1 and ::1 — Node resolves `localhost` to ::1 first): Postgres **5442**,
  api **4200**, app **3200** (override with `STACK_DB_PORT`, `STACK_API_PORT`, `STACK_APP_PORT`). Never 5432,
  3000, 4000, 3100, 4100; never the `robot-platform-db` container or its volume.
- **Keyless by default.** No image contains `.env` (`.dockerignore`), and no service reads the dev `.env`
  (compose's own `.env` interpolation is used only for `STACK_*` names). Keys and switches (`ANTHROPIC_API_KEY`,
  `TYPESAFE_API_KEY`, `JEV_SHADOW`, `WEBSITE_CHECKS`, `OPS_EMAILS`, …) come only from an optional, gitignored
  `./stack.env` given to api and worker. Without it: no AI, no Jev, no scheduled checks.
- **Light on memory.** The worker defaults to 2 browsers and 512 MB minimum free memory (`STACK_WORKER_*`).

## 3. Shape

One root `Dockerfile`, three targets; each installs only its package and its workspace dependencies
(`pnpm install --frozen-lockfile --filter "<pkg>..."`, pnpm pinned by `packageManager` through corepack, a
BuildKit cache mount for the store). The workspace packages export TypeScript source, so the api-server and the
worker run under `tsx` exactly as in dev (no separate compile step to drift).

| Service | Image / target | What it does |
|---|---|---|
| `postgres` | `postgres:16` | `pg_isready` healthcheck; volume `pgdata` |
| `migrate` | `api` | one shot: `drizzle-kit migrate` (`@robot/db`), then exits; api and worker wait for its success |
| `api` | `api` (`node:22-bookworm-slim`) | `@robot/api-server` on :4000; `/healthz` healthcheck; no Chromium in the image (the api-server never launches one) |
| `worker` | `worker` (`mcr.microsoft.com/playwright:v1.62.1-noble`: the `playwright-core` that `playwright-extra` resolves and launches with, not `@robot/browser`'s own `playwright` 1.58.2) | `@robot/worker`; `shm_size: 1gb`, `init: true` (reaps Chromium children), 30 s stop grace (its shutdown gives jobs back within 25 s) |
| `app` | `app` | `vite build` with `VITE_API_URL=http://localhost:<api port>` baked in, then `packages/app/serve.mjs` (Node only: `dist/client` files, everything else through the SSR handler) on :3000 |
| `backup` | `postgres:16` | nightly `pg_dump` loop + the backup/restore scripts (§5) |
| `fixture` | `busybox` (profile `test` only) | a static product page at `http://fixture:8080/` for checks with no outside website |

**Captures.** The worker writes screenshots and `.capture.json` files; the api-server serves them from
`packages/api-server/public/captures`. Both mount the `captures` volume at that path (`CAPTURES_DIR` set to it).

**The app's own server and the api-server.** The browser reaches the api-server at `http://localhost:4200`, but
inside the app container that address is the container itself. The one server-side call (`getSession`, the
SSR session lookup) now uses `API_INTERNAL_URL` when set (`http://api:4000` in compose), else the browser's
address — the only code change outside the new files; dev is unchanged. Cookies are host-scoped, not
port-scoped, so the session cookie set by `localhost:4200` reaches `localhost:3200` and is forwarded.
`APP_ORIGINS` is set to the app's host origin for CORS.

## 4. Running it

`docker compose up -d --build` (the first build pulls ~2 GB for the Playwright base), `docker compose ps`,
`docker compose logs -f worker`, `docker compose down` (keeps data) / `down -v` (drops this stack's volumes
only). On a low-memory machine build one target at a time (`docker compose build api`, then `worker`, `app`).

## 5. Backups

- **Nightly:** the `backup` service sleeps until `BACKUP_AT` (UTC, default `03:00`, `STACK_BACKUP_AT`), then runs
  `backup.sh`: `pg_dump --format=custom` to `./backups/robot_platform-<UTC stamp>.dump` (written as `.partial`,
  then renamed), keeping the newest `BACKUP_KEEP` (14, `STACK_BACKUP_KEEP`). A failure is logged and retried the
  next night.
- **On demand:** `docker compose exec backup sh /scripts/backup.sh`.
- **Restore:** `restore.sh <dump> <new-db>` restores into a new database (refuses an existing name);
  `restore.sh --replace <dump>` restores into a new database first, then swaps names, keeping the old database as
  `robot_platform_before_<stamp>` — stop `api` and `worker` first.
- **Restore test:** `restore-test.sh [dump]` takes a fresh dump (or the given one), restores it into
  `restore_test_<stamp>`, and compares every table in `public` and `drizzle` — row count and an md5 of the
  ordered rows — with the source (read before and after the dump, so a write during the dump is named, not
  hidden). Exits 0 only when every table matches; the test database is always dropped. (The content hash reads
  whole tables: fine for this stack; on a large database run it off-hours.)

## 6. Verification (the done-when)

Build images one at a time; `up`; then: the app answers `/login` on :3200; api `/healthz` on :4200; the
`drizzle.__drizzle_migrations` count equals the migration files (21); the worker logs its start and claims a
job — a signed-in `sources.reachability` call through the api for `http://fixture:8080/product.html` (profile
`test`), answered by the worker; a sign-in through the app in a real browser lands signed in (the SSR session
lookup over `API_INTERNAL_URL`); then `restore-test.sh` passes. `down`; nothing of the stack left running.
Report: `docs/testing/results/2026-10-23-docker-compose/report.md`.

## 7. Out of scope

Production hosting (TLS, secrets management, a registry, offsite copies of `./backups`), a compiled build of
the api/worker, and running the test suites in containers.
