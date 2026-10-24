# Email live check — 2026-10-24

`cd packages/worker && npx tsx src/live-email.ts` — free, local, keyless (`ANTHROPIC_API_KEY`, `JEV_SHADOW`,
`TYPESAFE_API_KEY` empty; `WEBSITE_CHECKS=off`, `RECURRING_RUNS=off`; its own `JOB_QUEUE`). Its own Mailpit container
(`robot-mailpit-check`, `axllent/mailpit:v1.32.0`, random 127.0.0.1 ports, removed at the end), a throwaway
`robot_bench_*` database (dropped at the end), the fixture shop at instant latency and an in-process worker sending
over SMTP to that Mailpit. Exit 0, every check `ok`, about two minutes. Raw result: [live-email.json](live-email.json).

| Message | How it was triggered | Reached (once each) | Link in text and HTML |
|---|---|---|---|
| `<website> needs your attention` | proof page 2 answers 404; the worker's real `website-check` job | owner, admin | `/projects/<p>/sites/<s>` |
| `A run of <website> failed` | a run whose two pages answer 404 settles `failed` | owner, admin | `…/runs/<runId>` |
| `Our team is working in your organisation` | an operator's `ops.enterOrg` | owner, admin | `/settings` |
| `Your role in <org> changed` | `orgs.members.setRole` member → admin | that member | `/settings` |
| `You were removed from <org>` | `orgs.members.remove` | that former member | `/login` |

Repeats sent nothing: a second website check while the website still needed attention, `notifyRunFailed` called
again on the same run, `ops.enterOrg` again from inside the org, the same role set twice, and a second removal
(refused). Mailpit held exactly 8 messages; none reached the operator or the outsider; no message named the shop's
host; all 8 `email_messages` rows ended `sent`. Afterwards no `robot-mailpit-check` container and no `robot_bench_*`
database were left, and `robot-platform-db` was still up.
