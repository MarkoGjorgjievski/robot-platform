# The whole stack in Docker Compose — implementation plan

**Status:** under the standing approval (queue item 1). All six steps done on `feat/docker-compose` 2026-10-23; verified end to end (results in `docs/testing/results/2026-10-23-docker-compose/`); not merged. Spec `docs/superpowers/specs/2026-10-23-docker-compose-design.md`.
Executed inline (no subagents, per the dispatch), worktree `C:\Users\Marko\Documents\projects\robot-platform-compose`,
branch `feat/docker-compose`.

**Global constraints:** never touch `robot-platform-db`, its volume, or ports 5432/3000/4000/3100/4100; every
docker command is scoped to project `robot-stack`; build images one at a time; bring the stack up only to verify,
then `docker compose -p robot-stack down`; commit by explicit path, never `routeTree.gen.ts`; trailer
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Shell scripts LF (`.gitattributes`).

- [x] **1. App server + internal API address.** `packages/app/serve.mjs` (static `dist/client`, else
  `dist/server/server.js`'s `fetch`; `Set-Cookie` kept as separate headers); `getSession` uses
  `API_INTERNAL_URL` when set. Check: local `vite build` + `node serve.mjs` answers `/login` 200 and an asset
  with its type; app typecheck clean; the app's tests pass.
- [x] **2. Dockerfile + .dockerignore.** Targets `api`, `worker`, `app` (spec §3). Check: each target builds alone.
- [x] **3. docker-compose.yml.** Services per spec §3, `name: robot-stack`, optional `stack.env`, `STACK_*`
  ports. Check: `docker compose config` renders; no service reads `.env`.
- [x] **4. Backups.** `docker/backup/{backup.sh,backup-loop.sh,restore.sh,restore-test.sh}`; `backups/` and
  `stack.env` gitignored. Check: in step 5.
- [x] **5. Verify end to end** (spec §6), with the exact commands and outputs in
  `docs/testing/results/2026-10-23-docker-compose/report.md`; then `down`, nothing left running.
- [x] **6. Docs.** `CLAUDE.md` Commands (run, ports, backup/restore), `.env.example` (the `stack.env` names),
  `docs/handoff.md` section, queue status.
