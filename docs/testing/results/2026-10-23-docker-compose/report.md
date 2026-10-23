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

## Fix round (after review, 2026-10-23)

**Changes** (one commit each): the stack is used and published on **127.0.0.1 only** (`VITE_API_URL`
`http://127.0.0.1:4200`, `APP_ORIGINS` `http://127.0.0.1:3200`, the `[::1]` port lines dropped; on `localhost`
the stack's `robot_session` cookie would collide with `pnpm dev:all`'s), smokes and docs on 127.0.0.1 URLs;
`backup.sh` refuses a `BACKUP_KEEP` that is empty, not a number or below 1 (exit 2), removes `$out.partial` on
failure or SIGTERM, writes dumps with `umask 077`; `restore.sh` passes names as psql variables, and `--replace`
blocks new connections (`ALLOW_CONNECTIONS false`), closes and waits out the open ones, then renames in one
transaction (on failure: reopens the live database and prints where the restore was left);
`restore-test.sh <dump>` documented as checking that dump against the current database; `init: true` on app and
api; the api image is built once (`migrate` uses it with `pull_policy: never`); comments say compose reads `.env`
only for `STACK_*` values; changing `STACK_API_PORT` needs `--build` (noted); `serve.mjs` handles a static file
stream error; `.dockerignore` excludes `**/.env`, `**/.env.*`, `**/stack.env`; an unused variable dropped from
`ui.mjs`.

**Re-verified on a fresh stack** (images rebuilt one at a time; `robot-stack/api` deleted first to prove the
single build), commands from the repo root, Git Bash with `MSYS_NO_PATHCONV=1`:

```
$ docker image rm robot-stack/api
$ docker compose up -d --build --quiet-pull
 robot-stack/worker  Built
 robot-stack/api  Built                      ← once
 robot-stack/app  Built
 … postgres Healthy, migrate Exited (0), api Healthy, app Started
$ docker compose ps -a
api        running   Up 6 seconds (healthy)     127.0.0.1:4200->4000/tcp
app        running   Up Less than a second      127.0.0.1:3200->3000/tcp
backup     running   Up 8 seconds               5432/tcp
migrate    exited    Exited (0) 6 seconds ago
postgres   running   Up 11 seconds (healthy)    127.0.0.1:5442->5432/tcp
worker     running   Up 6 seconds
$ docker inspect -f '{{.Name}} init={{.HostConfig.Init}}' robot-stack-api-1 robot-stack-app-1 robot-stack-worker-1
/robot-stack-api-1 init=true
/robot-stack-app-1 init=true
/robot-stack-worker-1 init=true
$ curl http://127.0.0.1:3200/login            → 200
$ curl http://127.0.0.1:4200/healthz          → {"status":"ok"}
$ curl "http://[::1]:4200/healthz"            → connection refused (curl exit 7): not published on ::1
$ docker compose exec -T app sh -c 'grep -o "http://127.0.0.1:4200" -r dist/client/assets | head -1'
dist/client/assets/index-B6SS1UTn.js:http://127.0.0.1:4200      (no "localhost:4200" in the bundle)
$ docker compose exec -T api printenv APP_ORIGINS
http://127.0.0.1:3200
$ docker compose exec -T postgres psql -U postgres -d robot_platform -tAc "select count(*) from drizzle.__drizzle_migrations"
21

$ docker compose --profile test up -d fixture
$ node docker/smoke/e2e.mjs
signed in: stack-smoke@example.com org stack-smoke
project: stack-smoke-13-50-48
website: 5b2b28b5-9725-445d-9d02-7fb9dd24a70f
capture started: ada701a9-c0b7-4991-8236-69b53d6a2164
capture: captured title "Stack Test Mug - Fixture Shop" tiles 1, boxes 4, page 800px
tile served by the api: /captures/bce04b18-1c94-4c08-97b6-d0067af57174.png 200 image/png 18245 bytes
same tile without a session: 401
total 5.3 s
$ node docker/smoke/ui.mjs docs/testing/results/2026-10-23-docker-compose
after sign-in: /projects
GET / with the session cookie: 307 location /projects
after reload: /projects
page shows the e2e project: true
browser errors: none
$ docker compose logs --no-log-prefix worker
[worker] stack-worker:23:d5cc24c3 on queue "default": browsers 2; lanes interactive 3, background 2, runs 1; min free memory 512 MB; website checks off
[worker] claimed proof-page-capture fca04ea3-8196-420b-9cda-16ca067353a0 (attempt 1 of 2)
[worker] done proof-page-capture fca04ea3-8196-420b-9cda-16ca067353a0

$ docker compose exec -T backup sh /scripts/restore-test.sh
[backup] wrote /backups/robot_platform-20261023T135058Z.dump (80K)
[restore-test] dump /backups/robot_platform-20261023T135058Z.dump → restore_test_20261023135059
… 27 rows of "ok" (drizzle.__drizzle_migrations 21/21, users 1/1, jobs 1/1, sessions 2/2, captures 1/1, …)
[restore-test] 27 tables, 31 rows restored; PASS                      (exit 0)
$ docker compose exec -T backup sh -c 'ls -l /backups'
-rw------- 1 root root 79215 Oct 23 13:50 robot_platform-20261023T135058Z.dump      ← umask 077

$ docker compose exec -T -e BACKUP_KEEP=0  backup sh /scripts/backup.sh
[backup] BACKUP_KEEP must be a whole number of at least 1 (got '0')    (exit 2)
$ docker compose exec -T -e BACKUP_KEEP=00 backup sh /scripts/backup.sh
[backup] BACKUP_KEEP must be a whole number of at least 1 (got '00')   (exit 2)
$ docker compose exec -T -e BACKUP_KEEP=x  backup sh /scripts/backup.sh
[backup] BACKUP_KEEP must be a whole number of at least 1 (got 'x')    (exit 2)
$ docker compose exec -T backup sh -c 'ls /backups | wc -l'
1                                                                      ← nothing written, nothing pruned

$ docker compose exec -T backup sh /scripts/restore.sh /backups/robot_platform-20261023T135058Z.dump "it's-a-name"
[restore] restored /backups/robot_platform-20261023T135058Z.dump into it's-a-name     (a quote in the name: passed as a psql variable)
$ (the same again)
[restore] database it's-a-name exists; pick another name               (exit 1)
$ docker compose exec -T backup psql -X -tAc "select count(*) from users" "it's-a-name"   → 1 ; dropdb "it's-a-name"

$ docker compose stop api worker app
$ docker compose exec -T backup sh /scripts/restore.sh --replace /backups/robot_platform-20261023T135058Z.dump
[restore] restored … into robot_platform_restoring_20261023135108
[restore] robot_platform now holds the restore; the previous one is robot_platform_before_20261023135108 (dropdb … when happy)
$ … psql -tAc "select datname, datallowconn from pg_database where datname like 'robot_platform%'"
robot_platform|t
robot_platform_before_20261023135108|t                                 ← both accept connections again
$ docker compose up -d ; curl http://127.0.0.1:4200/healthz             → {"status":"ok"}
$ (dropdb robot_platform_before_20261023135108)
$ docker compose exec -T backup sh /scripts/restore-test.sh
[restore-test] 27 tables, 31 rows restored; PASS                      (on the swapped-in database)

$ docker stats --no-stream
robot-stack-app-1 31 MiB, api 194 MiB, worker 256 MiB, postgres 71 MiB, backup 3 MiB, fixture 0.5 MiB
$ docker compose --profile test down -v
 … every robot-stack container removed; Volume robot-stack_pgdata Removed; Volume robot-stack_captures Removed; Network robot-stack_default Removed
$ docker ps -a --filter label=com.docker.compose.project=robot-stack ; docker volume ls -q --filter label=com.docker.compose.project=robot-stack
(nothing)
```

Not exercised: the `--replace` failure path (a swap that fails after the restore); its code reopens the live
database and names the left-over `robot_platform_restoring_<stamp>`. The test dumps in `./backups` were deleted;
the three `robot-stack/*` images stay.
