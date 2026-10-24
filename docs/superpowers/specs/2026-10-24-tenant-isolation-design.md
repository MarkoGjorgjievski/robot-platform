# Tenant isolation audit, as tests — design

**Status:** written 2026-10-24 under the standing approval (`CLAUDE.md`, "Autonomous runs"; `docs/queue.md` item 1,
"Tenant isolation audit, as tests"). Plan: `docs/superpowers/plans/2026-10-24-tenant-isolation.md`. Branch
`feat/tenant-isolation` from `main` @ `45e0bdf3`, worktree `C:\Users\Marko\Documents\projects\robot-platform-tenant`.

## 1. Why

The queue item covers three things:
- two organisations, with every api procedure and every file route called across them, and all refused;
- money fields removed from customer answers;
- rate limits.

**Done when:** the sweep test passes.

The code audit (2026-10-24) found three things:
- **Org checks.** Every id-taking procedure goes through `sourceInOrg`, `runInOrg`, `captureInOrg`, `findProjectInOrg`
  or `loadDatasetInOrg`, or filters on `ctx.session.org`. A foreign id answers `NOT_FOUND`, the same as a missing one.
  The file routes (`/captures/*`, `/export/runs/*`, `/export/projects/*`) check the org too.
  - **Gap:** the existing cross-org tests (`site-scope.test.ts`, `datasets-org.test.ts`) list procedures by hand and
    miss about a dozen of them. Nothing makes a new procedure prove its scoping.
- **Money reaches customers in answers.** The app hides amounts from customers (`showsMoney`), but the api still
  sends them to any member. The fields are:
  - `runs.listByOrg` `costUsd`;
  - `sources.verificationStatus` `costUsd`;
  - `sources.verifyEstimate` `upperBoundUsd` / `perFieldUsd`;
  - `crawl.backfillPreview` `estCostUsd`;
  - `usage.byProject` `spendUsd`;
  - `orgs.staffActivity` `run.costUsd`.

  Marko's rule (2026-10-17) is that a customer sees no money anywhere. An answer the browser receives counts.
- **No rate limits** anywhere: not on sign-in, not on Verify or runs, not on the worker-backed address checks.

## 2. The design

### 2.1 The procedure sweep

`packages/api/src/isolation/procedure-sweep.test.ts` enumerates `appRouter._def.procedures`, the same way
`staff-guard.test.ts` already does.

**The classification table.** `isolation/procedure-classes.ts` exports one entry per dotted path:

| Class | Meaning | What the sweep asserts |
|---|---|---|
| `scoped` | takes ids of one org's rows | org A's caller, given org B's ids, gets `NOT_FOUND`; org B's rows are unchanged after the call (row snapshots before and after) |
| `org-wide` | no ids; answers about the caller's org | org A's answer contains none of org B's ids, slugs or names (a deep scan of the JSON) |
| `self` | only the caller's own user or session | A's call never changes B's user or session rows |
| `membership` | takes a user or org id that must be a membership of the caller (`auth.switchOrg`, `orgs.members.*`) | with B's org id or B's user id: refused (`NOT_FOUND` / `FORBIDDEN`), B unchanged |
| `ops` | operator only | a non-operator gets `FORBIDDEN` |
| `public` | no session needed | listed explicitly; must not leak another org's data |
| `stateless` | touches no org's rows (the address checks) | covered by the rate limit (§2.4), not by scoping |

**The rules.**
- The sweep fails when a procedure is missing from the table or the table names one that no longer exists. A new
  procedure must be classified before it can merge.
- For `scoped`, the table gives an input builder `(b: OrgFixture) => input`. It is fed with org B's ids.
- For every class except `public`, the same call with no session must answer `UNAUTHORIZED`.
- No call may start a browser, an AI call or real work. A refused call refuses before anything is queued, so the
  sweep also checks that no job was enqueued on the test queue for org B's ids.

**The fixture.** `isolation/two-orgs.ts` builds orgs A and B, each with:
- a project, a dataset with fields and a website with a binding (`createProjectWithSource`);
- a run with items, and a proof-page capture row with its file on disk;
- a verification row, a drift check and a coverage check (the existing `seed-*` helpers);
- a variant setup, an email message, a staff action, and a `run_files` snapshot with a webhook secret;
- a second member.

Everything is cleaned up afterwards. It is built through the real procedures where they are cheap, and inserted
directly where they would launch work, as the existing tests do.

### 2.2 The file-route sweep

`packages/api-server/src/isolation-routes.test.ts` runs against the Hono app in-process, with org B's run, project,
capture file and snapshot:

| Request | No session | Org A's session | Notes |
|---|---|---|---|
| `GET /captures/<B's file>` | 401 | 404 | traversal (`../`, `%2e%2e`, `\`) is 400 |
| `GET /export/runs/<B's run>.csv\|json\|xlsx` | 401 | 404 | |
| `GET …?snapshot=1` | 401 | 404 | |
| signed link for B's run | 200 by design | — | a tampered sig, an expired link, another run's sig, a wrong format, or a sig made before a rotated secret all give the same 404 |
| `GET /export/projects/<B's project>.<fmt>` | 401 | 404 | |

Org B's own session gets 200 on each, so the fixture is proven real.

### 2.3 No money in customer answers

**Server-side redaction.** A single helper, `isolation/money.ts`, defines `viewerSeesMoney(ctx) = ctx.isOperator ||
!!ctx.session?.staff`, the same rule as the app's `showsMoney`. Each money-bearing procedure leaves its money fields
out (`undefined`, not 0) when it is false:

| Procedure | Fields left out for a customer |
|---|---|
| `runs.listByOrg` | `costUsd` |
| `sources.verificationStatus` | `costUsd` |
| `sources.verifyEstimate` | `upperBoundUsd`, `perFieldUsd` (it still answers `aiAvailable`, field counts, etc.) |
| `crawl.backfillPreview` | `estCostUsd` |
| `usage.byProject` | `spendUsd` (per project and total) |
| `orgs.staffActivity` | `run.costUsd` |
| any other found by the sweep | its money fields |

The app's types make these fields optional. Its screens already show them only when `showsMoney`, so a customer sees
nothing different.

**The sweep.** `isolation/money-sweep.test.ts` calls every `scoped`, `org-wide` and `self` query as a plain customer
of org A, on org A's own fixture, which includes runs with a cost and a verification with a cost. It deep-scans each
answer for a key matching `/usd|cost|spend|price(?!s?$)/i` whose value is a number or a numeric string.
- **Excluded subtrees:** scraped data (`data`, `values`, `rows`, `fields`, `expected`, and the export row objects),
  because a customer's own "price" field is their data, not our money. The list is short and written in the test.
- **The same calls as staff (in staff mode) must return the money fields**, so the redaction is not simply deleting
  data.

### 2.4 Rate limits

`isolation/rate-limit.ts` is a fixed-window counter in the api process (a `Map` with a 1-minute window, pruned). It is
applied as tRPC middleware on `publicProcedure` / `protectedProcedure` by procedure group:

| Group | Procedures | Limit | Key |
|---|---|---|---|
| sign-in | `auth.signIn` | 10 / min | per email (lower-cased) |
| sign-in | `auth.signIn` | 30 / min | per client IP |
| heavy | `sources.verify`, `sources.confirm`, `sources.captureProofPage`, `crawl.plan`, `crawl.probeAndSample`, `crawl.execute`, `crawl.backfill`, `sources.detectVariants`, `sources.transferMarks` | 30 / min | per org |
| network | `sources.reachability`, `sources.checkListingPage`, `sources.variantLinksNear`, `sources.variantList` | 60 / min | per org |
| everything else | | 600 / min | per session |

**Refusals.**
- **Customer wording:** a refused call answers `TOO_MANY_REQUESTS` with "Too many requests. Wait a minute and try
  again.". The app's `mutationErrorText` passes that sentence through, and the sign-in form shows it.
- **Client IP:** it comes from the api-server's request (`x-forwarded-for` only when `TRUST_PROXY=on`, else the socket
  address), passed into the tRPC context.
- **Staff:** they are limited like anyone else, on their own key.
- **Switch:** `RATE_LIMITS=off` turns it off. Both vitest configs set it off, and the limiter's own tests turn it on
  in-process with injected limits.
- **Scope:** one limiter per api-server process. That is enough for one server; several servers would need a shared
  store (noted as Open).

**Tests:**
- the counter (window, keys, prune);
- each group's key and limit;
- `signIn` refused on the 11th call for one email, and on the 31st from one IP;
- a heavy procedure refused on the 31st call for one org while another org is unaffected;
- the refusal sentence;
- the app shows the sentence on the login form and through `mutationErrorText`.

## 3. What is fixed if the sweep finds a hole

Any procedure the sweep shows unscoped is fixed on this branch: scoped through the existing helpers, with the row in
the table. Any file route likewise. The spec's §1 list is what the audit found; the sweep is the proof.

## 4. Safety properties

1. Every tRPC procedure is classified, and every id-taking one refuses another org's ids.
2. Every file route refuses another org's file without a valid signed link.
3. No customer answer carries a money amount; staff answers still do.
4. Repeated calls cannot exhaust sign-in or the heavy and network work beyond the limits.
5. Nothing paid; no browser launched by the sweeps.

## 5. Testing

- Everything in §2.1–2.4.
- The route smoke on the isolated pair, which also proves the app works without money fields for a customer.

## 6. Not in this spec

- Distributed rate limits.
- Per-role money visibility (e.g. owners seeing spend). Per Marko, customers see no money at all.
- Billing.
- Abuse detection beyond fixed windows.
- Real authentication (sign-in still accepts any password — Needs Marko).
