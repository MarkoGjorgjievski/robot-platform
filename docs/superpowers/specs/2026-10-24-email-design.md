# Email, with a local catcher — design

**Status:** implemented on `feat/email` and merged to `main` on 2026-10-24 (`35fcfc3e`); written 2026-10-24 under the standing approval (`CLAUDE.md`, "Autonomous runs"; `docs/queue.md` item 1,
"Email, with a local catcher"). Plan: `docs/superpowers/plans/2026-10-24-email.md`. Branch `feat/email` from `main` @
`310371e1`, worktree `C:\Users\Marko\Documents\projects\robot-platform-email`.

**Proven:** the live check (`docs/testing/results/2026-10-24-email/live-email.md`, re-run on the final head) — each of
the five messages through its real path into a throwaway Mailpit: eight messages, each to the right person once, with its
link in text and HTML; the repeats (a second check, the same failed run again, entering again, the same role twice, a
second removal) sent nothing; nothing reached the operator or an outsider; no message named the shop's host. Tests: db 33,
scraper 1,314, api 1,680, worker 18, app 1,096, api-server 74, tsc clean; the route smoke on the isolated pair (28 of 28),
its Account screenshots showing the Email panel in both themes.

**Deviations and settled here** (reviews, 2026-10-24): an email is sent only while its recipient may still get it — at
send time attention and failed-run messages need an owner or admin with that switch on, staff access an owner or admin,
a role change any member; otherwise the row is `skipped` with the reason (a removal always sends); the attention sync
only reads whether a Verify is in flight and never closes a stalled Verify row; one sync per website at a time, under its
row lock; a queueing failure logs one line (the database message and code, never the query or its values); a role change
reads the current role under the membership row lock. Mailpit (§3.5) keeps its messages in a file inside its container,
not in memory: they survive a restart and go when the container is recreated; nothing reaches the host. A real provider
must use `smtps://…:465` or `smtp://…:587?requireTLS=true` — never `tls.rejectUnauthorized=false` — and not before
real sign-in (anyone can sign in as any address today).

## 1. Why

A customer only learns that a website needs attention, or that a run failed, by opening the app. Account events (staff
working in the organisation, a role change, removal) are shown only in Settings. The queue item asks for email for
"Needs attention", failed runs and account messages, sent over SMTP. Locally a Mailpit container catches it; a real
provider is a configuration change.

**Done when** (queue): each message is sent and seen in Mailpit; a real provider is a config change.

## 2. What exists and is reused

- **Needs attention** is computed, not stored: `websiteAttention()` / `needsAttention()` in `verify/attention.ts`. It
  changes when Verify writes holds (`run-source-verification.ts`, `writeHolds`) and when a drift check finishes
  (`run-drift-check.ts`).
- **Failed runs:** every terminal path (finalise, the executor throwing, the job layer closing a run) already calls
  `enqueueRunDelivery`.
- **Jobs and delivery:** the jobs queue (background lane, retries with backoff), and the delivery pattern of
  `run-delivery` + `webhook_deliveries`.
- **Recipients:** `users` (one email each) and `memberships` (`owner | admin | member`). There are no notification
  preferences today.
- **Staff access:** `staff_actions` records entering an org (`ops.enterOrg`) and each staff mutation.
- **No mail library** in the repo; sign-in has no real check, and there are no invitations (so no sign-in or invite
  emails — out of scope, §8).

## 3. The design

### 3.1 Messages

| Kind | When | To | Subject |
|---|---|---|---|
| `attention` | a website turns to "Needs attention" (off → on) | the org's owners and admins who keep this kind on | "<website> needs your attention" |
| `run-failed` | a run settles `failed` (not a sample) | the org's owners and admins who keep this kind on | "A run of <website> failed" |
| `staff-access` | staff enter the org (`ops.enterOrg`) | the org's owners and admins (always) | "Our team is working in your organisation" |
| `role-changed` | `orgs.members.setRole` changes someone's role | that member (always) | "Your role in <org> changed" |
| `removed` | `orgs.members.remove` removes someone | that former member (always) | "You were removed from <org>" |

Every message is plain text plus a simple HTML version, and has the same content in both. Each one names:
- what happened, in one or two sentences of customer words;
- the website, project and organisation names;
- one link into the app on `PUBLIC_APP_URL` (default `http://localhost:3000`): the website's Verification tab, the
  run page, Settings, or the sign-in page for a removed member;
- for `attention` and `run-failed`, a footer: "You get this because you look after <org>. Choose which emails you get:
  <PUBLIC_APP_URL>/account".

The bodies follow the customer-copy rules: no money, no HTTP codes, no hosts other than the app link, never "budget",
no internals (no model, no "Jev", no job or queue words). For `attention`, the reason is the attention view's own
customer sentence (`attention-view` / the Settings sentence). For `run-failed`, it is the run's stored sentence through
the same rewording the app uses (`captureWords(text, false)`); that function moves to a shared place both the app and
the api can import, or the api gets a copy with a test that keeps the two equal.

### 3.2 Once per event

**`attention`.** Websites gain `attention_since timestamptz`. `syncAttention(db, sourceId)` runs after every write that
can change it: the Verify transaction that writes holds, a finished drift check, a refresh's re-verify, and an edit
that clears a hold. It computes `needsAttention`:
- On and `attention_since` is null: it sets it with `UPDATE … WHERE attention_since IS NULL RETURNING`, and only the
  writer that wins sends.
- Off: it sets `attention_since` back to null. A later turn to on is a new event.

**Dedupe keys.** Every message has one, unique in `email_messages`:
- `attention:<sourceId>:<attention_since epoch ms>:<userId>`
- `run-failed:<runId>:<userId>`
- `staff-access:<staffActionId>:<userId>`
- `role-changed:<membershipId>:<newRole>:<epoch ms>:<userId>`
- `removed:<orgId>:<userId>:<epoch ms>`

An insert that hits the key does nothing.

### 3.3 Sending

**Queueing.**
- `queueEmails(db, event)` resolves the recipients, renders every message, and inserts one `email_messages` row per
  recipient: `id`, `org_id`, `user_id` (nullable for a removed member), `kind`, `dedupe_key` (unique), `to_address`,
  `subject`, `text`, `html`, `status` (`queued | sent | failed | skipped`), `attempts`, `error`, `created_at`,
  `sent_at`.
- In the same transaction it enqueues one `email` job per row (background lane, priority 25, 5 attempts, key
  `email:<messageId>`).
- The callers are the Verify/drift paths through `syncAttention`, the three run-terminal paths next to
  `enqueueRunDelivery` (each in its own try/catch, like delivery), and the two membership mutations and `ops.enterOrg`
  inside their own transactions.

**The `email` job** (worker) sends the row through nodemailer with `SMTP_URL`, from `MAIL_FROM`:
- **`SMTP_URL`:** for example `smtp://127.0.0.1:1025` for Mailpit, or `smtps://user:pass@smtp.provider.com:465`.
  Empty means mail is off: rows are written as `skipped` and nothing is sent.
- **`MAIL_FROM`:** default `"Robot Platform" <no-reply@localhost>`.
- **Outcome:** success sets `sent`; an SMTP error is a failed attempt, retried with the job backoff; after 5 it is
  `failed` with the stored error.
- **Limits:** a 15 s connection and send timeout. One message per job, so one recipient's failure never blocks
  another's.

**Preferences.** Users gain `email_attention boolean not null default true` and `email_failed_runs boolean not null
default true`. The account messages (`staff-access`, `role-changed`, `removed`) are always sent.

### 3.4 What a customer sees

- **Account page:** a new "Email" panel with two switches, "When a website needs attention" and "When a run fails".
  Each saves on change through `account.updateEmailPrefs`, plus one line: "Account messages are always sent."
- **Nothing else changes in the app.** Staff see sent and failed counts in ops later (out of scope); the
  `email_messages` row is the record.

### 3.5 Local catcher

- **`docker-compose.yml`:**
  - a `mailpit` service (`axllent/mailpit`, pinned tag), SMTP on the internal network, its web UI published on
    `127.0.0.1:${STACK_MAIL_PORT:-8225}`;
  - the stack's worker gets `SMTP_URL: smtp://mailpit:1025` by default and the stack's app link base;
  - Mailpit keeps its messages in memory; nothing is stored on disk.
- **For `pnpm dev:all`:** a one-line `docker run` for a Mailpit on `127.0.0.1:1025` / `127.0.0.1:8025`, named
  `robot-mailpit`, in `.env.example` and `CLAUDE.md`. `SMTP_URL` stays unset in `.env` until Marko sets it, so mail
  is off by default.

## 4. Safety properties

1. No email is ever sent to an address that is not a member of the org the event belongs to (a removed member gets
   exactly the one removal message, built before the delete).
2. An event sends at most one message per recipient (unique dedupe key; the `attention_since` claim).
3. Mail being off, down or slow never changes a run, a Verify, a check or a membership mutation. Queueing failures are
   caught and logged; sending happens in the worker.
4. No message text carries money, HTTP codes, hosts other than the app link, "budget", or internals (a sweep test over
   the rendered bodies).
5. Staff in staff mode never receive customer notification emails because of their own session; staff-access emails
   go only to the org's owners and admins.
6. Nothing paid.

## 5. Testing

**Unit:**
- the renderers: every kind, with the customer-copy sweep over subject + text + html;
- recipient resolution: role filter, preferences, a removed member;
- dedupe keys;
- the shared `captureWords`, equal for app and api.

**API (Postgres, per-file queue):**
- `syncAttention` sends once on off → on, not again while on, and again after on → off → on;
- two concurrent syncs send once;
- a failed run queues emails, and a completed run or a sample does not;
- `setRole`, `remove` and `enterOrg` queue their messages in their own transactions;
- preferences are respected;
- the `email` job against a local SMTP test server (an in-process SMTP sink, no Docker in unit tests): sent; a
  temporary failure is retried; mail off gives `skipped`.

**App:** the Account panel's view function; the copy sweep; the route smoke checks that the panel renders (it never
toggles).

**Live check (free, the "done when"):** `packages/worker/src/live-email.ts`:
- **Setup:** it starts its own Mailpit container (`robot-mailpit-check`, random free ports, removed in `finally`), a
  throwaway database, and an in-process worker with `SMTP_URL` at that Mailpit.
- **Events:** it triggers each of the five kinds through the real code paths: a website whose drift check turns it to
  attention, a failed run, `enterOrg`, `setRole`, `remove`.
- **Checks:** it reads Mailpit's HTTP API and checks that each message arrived once, to the right address, with the
  right subject and link, and that a repeated event sent nothing more.

## 6. Configuration

- **Who reads what:**
  - **Worker** (sending): `SMTP_URL`, `MAIL_FROM`.
  - **Api-server and worker** (building links): `PUBLIC_APP_URL`.
- **A real provider is configuration only:** set `SMTP_URL` to the provider's SMTP URL with credentials (for example
  `smtps://apikey:<key>@smtp.sendgrid.net:465`) and `MAIL_FROM` to a verified sender. No code change.

## 7. Settled here

- Owners and admins get website and run emails; members do not. There is no per-website override.
- `partial` and `cancelled` runs send nothing; only `failed` does.
- The product name appears only in `MAIL_FROM`'s display name, which is configurable.

## 8. Not in this spec

- Sign-in links, password reset and invitations (no real authentication yet).
- Digests or batching.
- Per-website recipients.
- Staff notification emails and an ops view of email.
- Unsubscribe by link without signing in.
- Bounce handling.
- A "back to normal" email when attention clears.
