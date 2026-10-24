# Metering and spend caps per organisation — design

**Status:** implemented on `feat/metering` and merged to `main` on 2026-10-24 (`28948402`); written 2026-10-24 under the standing approval (`CLAUDE.md`, "Autonomous runs"; `docs/queue.md` item 1,
"Metering and spend caps per organisation"). Plan: `docs/superpowers/plans/2026-10-24-metering.md`. Branch
`feat/metering` from `main` @ `2fc0d8b2`, worktree `C:\Users\Marko\Documents\projects\robot-platform-metering`.

**Proven:** the full runs on the final code head (`28948402`): `@robot/db` 34, `@robot/agent` 67 (3 live tests skipped
keyless), `@robot/scraper` 1,318 (5 skipped), `@robot/api` 2,057 (140 files), `@robot/api-server` 88,
`@robot/worker` 18, `@robot/app` 1,115 (the two smokes skipped); `tsc --noEmit` clean in all seven. The feature's own
tests: metering and the limit's state 9 (`metering.test.ts`: UTC month edges, samples out of `runs` but in `aiUsd`,
equality with `usage.byProject`, org value / default / `none` / a typo, `reached` at equality); the capped agent 14
and the per-job usage scope 14 (`@robot/agent`); Verify at the limit 8 (`run-source-verification-cap.test.ts`) plus 3
in `run-verification.test.ts`; planning 8 (`plan-source-cap.test.ts`); execution 34 (`start-execution.test.ts`, the
breaker at three among them); `setAiCap` and `ops.orgs` 8 (`orgs-ai-cap.test.ts`); the app's view functions 21
(Usage's Runs, the staff panel, ops Organisations). The procedure sweep covers 87 procedures; the money sweep (51)
checks that `verifyEstimate.cap` reaches staff only. The route smoke passed 28 of 28 and the staff smoke 1 of 1 on one
isolated keyless pair from the branch, with no `[rate-limit]` line. The screenshots: the customer's Usage shows
"0 runs" under the headline and a Runs column, and no money, in both themes; the customer's Settings has no limit panel;
the staff panel (`staff-settings-ai-limit.png`) reads "$0.00 spent this month · $40 limit · $40.00 left" with the
default hint and Save; ops → Organisations (`staff-ops-orgs.png`) shows the throwaway org with "$40", 0 % and Jev
muted; the customer's staff log reads "Changed a setting of this organisation".

**Deviations:** the reviews forced these. (1) Recorded costs are per job: `withUsageScope` (`@robot/agent`,
AsyncLocalStorage) gives each Verify, plan and run its own tally. The process-wide usage diff would have charged one
org's spend to another's row under concurrency, and the limit reads those rows. (2) A Verify takes its org's slot before
it reads what is left, and records its cost on every exit before the slot closes. (3) `verifyEstimate.aiAvailable` is
false once less than one field's estimate is left, not only at the limit. (4) A capped plan answers with the one
sentence as its only error and no walk warnings. A refusal that escapes the walk reaches the caller as
`PRECONDITION_FAILED` with the same sentence. (5) Calls to the free local model (Ollama) are neither refused nor
counted. (6) A refused catalogue lookup is counted apart and never fails a page that needed no AI (§3.2 over the plan).
(7) The operator CLI `crawl-plan.ts` stays capped: it plans a customer org's website, and keeping to that org's limit is
the safe side. Settled in the plan ("Settled here", 19 rulings): a refused call is not a call; the in-process registry
per org; the edges of the limit; a typo falls back to $25; planning fails the run and does not throw; the customer reads
a limit change as "Changed a setting of this organisation" and never receives the `action` key; `routeTree.gen.ts`
staged with the `/ops/orgs` lines only.

## 1. Why

The queue item: pages, runs and AI spend counted per org; AI work stops at a cap.

**Done when:** tests; ops shows it.

What the code audit found (2026-10-24):

- **AI spend is recorded, but nothing limits it.**
  - Verify's AI fallback is the only customer AI path at field level: `run-source-verification.ts`,
    `SchemaAgent.proposePaths` via `ai-fallback.ts`, cost in `source_verifications.cost_usd`.
  - Planning a run is the other one: `plan-source.ts`, listing-walk selectors and pagination, cost in
    `runs.cost_usd`.
  - Execution uses AI only for legacy sources without a customer schema; a certified website runs its certified paths
    only.
  - Jev readings are a staff-only shadow experiment, with their own cost column and a global daily budget.
- **Pages and spend are counted per project and month** (`usage.byProject`) and per website (`ops.websites`). Runs are
  not counted anywhere.
- **No cap exists.** `verifyEstimate.aiAvailable` only means "a key is set".

## 2. The design

### 2.1 What is counted

`metering/org-usage.ts` exports `orgUsage(db, orgId, month)`, with the month in UTC and `monthBounds` reused:

| Measure | Source |
|---|---|
| `pages` | `captures` rows created in the month, for the org's websites |
| `runs` | `runs` created in the month for the org's websites, samples (`input_label = 'probe'`) excluded |
| `aiUsd` | the month's sum of `source_verifications.cost_usd` (by `started_at`) and `runs.cost_usd` (by `created_at`), the same as `usage.byProject` |
| `jevUsd` | the month's sum of `jev_readings.cost_usd`; staff-only, never counted against the cap |

`usage.byProject` and `ops.websites` keep their meaning. `orgUsage` has a test that it equals the sum of
`usage.byProject`'s rows for that org.

### 2.2 The cap

**Setting.** `orgs.ai_cap_usd numeric(10,2)`, nullable. The effective cap is:
- the org's own value when set;
- else `ORG_AI_CAP_USD` (env, default `25`);
- `ORG_AI_CAP_USD=none` means no default cap. An org's own value still applies.

**State.** `orgCapState(db, orgId)` returns `{ capUsd: number | null; spentUsd; remainingUsd: number | null; reached:
boolean }`, where `reached` means `spentUsd >= capUsd`. It is computed on demand from `orgUsage`, with no counter
table, so it can never drift from the recorded costs.

**Who sets it.** Staff, through `orgs.setAiCap({ capUsd: number | null })` (null means "use the default"):
- **Allowed:** an operator in their own org, or staff in staff mode in a customer's org. Anyone else gets `FORBIDDEN`.
- **Logged:** in staff mode, through the existing staff-action logging, in staff words: "Set the monthly AI limit to
  $40", or "Reset the monthly AI limit to the default".
- **Not on the staff deny list.**

### 2.3 Where AI work stops

**Org for a call.** `orgIdForSource(db, sourceId)` is added beside `orgIdForRun` (`export/org-for-export.ts`), so worker
jobs can resolve their org without a session.

**Verify.**
- **Before any AI:** `run-source-verification` reads `orgCapState`. If `reached`, it builds no agent, exactly like a
  keyless Verify. Fields that would need AI resolve with `failReason: 'ai_unavailable'`, and the existing badge and
  sentence show, with no new customer copy.
- **During a Verify:** the agent is wrapped in `cappedAgent(agent, { remainingUsd, perCallUsd })`. Before each
  `proposePaths` it projects `calls × perCallUsd`; when the projection would pass `remainingUsd`, it throws
  `CapReachedError`. That field resolves `ai_unavailable`, and the rest of the Verify carries on.
- **The per-call figure:** `perCallUsd` is the per-field estimate `verifyEstimate` already uses (its
  `perFieldUsd` constant).
- **The shared-counter problem:** the projection uses calls × estimate, not the process-wide usage counter, which
  other concurrent jobs share.

**`verifyEstimate`.** `aiAvailable` becomes "key set **and** the cap is not reached". A customer's Verify button then
behaves as it does with no key: fields needing AI are shown as not tried. Staff additionally receive `cap: { capUsd,
spentUsd, remainingUsd }` through `moneyFields`.

**Planning (`plan-source.ts`).** The agent is wrapped the same way, with every model method guarded and the projection
using a per-call planning estimate (constant `PLAN_CALL_USD = 0.05`).
- When the cap is reached before or during planning, planning stops.
- The planning run ends failed with "This organisation has reached this month's limit for automatic setup. Ask us to
  raise it.". That is the only new customer sentence. It names no AI, no money and no mechanism.
- A planning step that needs no model call (a certified listing's cached selectors) is unaffected.

**Execution.** Legacy sources only: the same wrapper is applied at `start-execution.ts`'s agent. A `CapReachedError`
from an item fails that item with the planning sentence, and three in a row stop the run through the existing
`stopForWall`-style breaker (`stopForCap`). Certified websites never reach this path.

**Not capped.**
- The judge and the staff CLIs: they are not org work, and they keep their own `--max-usd` / env-off guards.
- Jev: a staff experiment with its own global daily budget.

### 2.4 What staff see (ops)

**A new "Organisations" view, `/ops/orgs`**, linked from the ops header. It is read-only and comes from `ops.orgs`
(an `opsProcedure`). It has one row per org:
- name, the number of websites, and pages, runs and AI spend this month;
- the effective cap, with "(default)" when it comes from the env;
- % used, with a "Limit reached" badge at 100 %;
- Jev spend this month in a muted column;
- sorted by % used, highest first.

The month can be chosen: this month or any of the last 6.

**Elsewhere for staff:**
- **Org Settings, in staff mode:** a "Monthly AI limit" panel shows spent / cap / remaining this month. It has a
  number field ("Leave empty to use the default ($25)") and Save, using `orgs.setAiCap`.
- **The customer:** sees neither the panel nor any amount (`showsMoney`).

### 2.5 What a customer sees

- **Usage page:** gains a "Runs" count beside "Pages captured", for the month and per project. There is no money.
- **When the cap is reached:**
  - Verify marks the fields that need AI with the existing "not tried" badge and sentence.
  - Planning shows the one new sentence.
  - Nothing else changes.

## 3. Safety properties

1. No org's month AI spend passes its cap by more than one projected call's estimate, whatever the concurrency of its
   own jobs. This holds within one worker process, and in projected dollars: the projection is calls × an estimate, so a
   call that costs more than its estimate can carry real spend past the limit by the difference.
2. A cap never stops work that needs no AI. That covers certified extraction, drift, coverage and website checks, and
   every mechanical Verify.
3. A customer never sees an amount, the cap, or the words "AI", "model" or "budget".
4. Only staff and operators can change a cap, and in staff mode it is logged.
5. Metering is computed from the recorded costs, so it cannot drift from them.

## 4. Testing

- **Unit:**
  - `orgUsage`, including the month bounds (UTC midnight edges), samples excluded, and equality with
    `usage.byProject`;
  - `orgCapState`: org value, env default, `none`, reached at equality;
  - `cappedAgent`: projection, throws at the edge, per-call counting.
- **API:**
  - `setAiCap` by operator, by staff in staff mode, and refused for a customer; the staff log sentence;
  - `verifyEstimate` with and without the cap reached, as customer and as staff;
  - `ops.orgs` as operator, and refused for others.
- **Verify, with mocked agents (no real AI):**
  - an org at its cap runs no `proposePaths` and the AI fields show `ai_unavailable`;
  - an org with room for 2 calls runs 2 and the third field shows `ai_unavailable`;
  - a mechanical-only Verify is unaffected.
- **Planning, with a mocked agent:** cap reached → the run is failed with the sentence; a plan needing no model call is
  unaffected.
- **Execution, legacy path:** three capped items stop the run.
- **App:**
  - the Usage page Runs count;
  - the staff Settings panel's view function;
  - the ops Organisations view function;
  - the copy sweep;
  - the route smoke walks `/ops/orgs` as an operator. The smoke's operator, if it has one; otherwise the staff smoke
    covers it, as the plan settles.
- **Live check:** none needed (no capture or extraction change). The isolated-pair smoke covers the screens.

## 5. Not in this spec

- Billing and invoices.
- Notifying anyone when a cap is reached. The ops badge is the signal for now.
- Per-project caps.
- Caps on pages or runs (counted only).
- Jev in the cap.
- A customer-visible "limit" page.
