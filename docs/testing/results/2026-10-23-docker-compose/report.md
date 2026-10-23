# Docker Compose stack — verification (2026-10-23)

Branch `feat/docker-compose`. Run keyless (no `stack.env`), from nothing to `docker compose -p robot-stack down -v`.
Project `robot-stack`: app on 3200, api on 4200, Postgres on 5442, bound to 127.0.0.1 and ::1 only, its own
volumes. Marko's `robot-platform-db` (port 5432) was untouched throughout.

## Images (built one at a time)

| Image | Size |
|---|---|
| api | 727 MB |
| worker (Playwright v1.62.1-noble base) | 3.77 GB |
| app | 630 MB |

No image contains `.env` (`.dockerignore`).

## End to end

- `docker compose up -d --build`: every service up; the migrate service exited 0 with 21 of 21 migrations applied;
  `/healthz` answered `{"status":"ok"}`.
- App: `/login` 200; a signed-out `/` redirects (307) to `/login`.
- Worker: started with 2 browsers, website checks off. It answered `sources.reachability` for a fixture page served
  inside the stack (`http://fixture:8080/product.html`) with "ok", HTTP 200, and claimed a proof-page capture of the
  same page, finished in 3.6 s, writing the `.png` and `.capture.json` to the shared captures volume. The api served
  that screenshot with 200, and 401 without a session.
- Real browser: sign-in through `/login` landed on `/projects`; after a reload still signed in, project shown, no
  browser errors — the app's server reaches the api over `API_INTERNAL_URL`.
- Memory after a capture: worker ~350 MB, api 140 MB, app 56 MB, Postgres 70 MB.

## Backup and restore

- Restore test: PASS — all 27 tables (public + drizzle) equal row counts and content hashes (31 rows; an earlier run
  with more data, 35 rows, also passed). A stale dump correctly fails (jobs 4 vs 3, sessions 5 vs 4, exit 1).
- `restore.sh <dump> <new-db>` works and refuses an existing name; `--replace` swaps databases and keeps the old one
  as `_before_<stamp>`; the stack came back healthy.
- The nightly loop dumped at the set minute, pruned to `BACKUP_KEEP`, and stopped on SIGTERM.

Both smoke scripts (`docker/smoke/e2e.mjs`, `docker/smoke/ui.mjs`) were re-run from their committed copies on a fresh
`up` with the same results, then `down -v`. Screenshots in this folder.

## Known limits

- Playwright: `@robot/browser` declares `playwright` 1.58.2 but launches through `playwright-extra`, which resolves
  `playwright-core` 1.62.1 — the worker image must match 1.62.1. Aligning the declared versions is a follow-up.
- Not a production deploy: api and worker run TypeScript under tsx; `NODE_ENV` is not `production` (cookies not
  `Secure`); no TLS; no offsite copy of `./backups`.
- The restore test hashes whole tables — fine at this size, slow on a large database.
