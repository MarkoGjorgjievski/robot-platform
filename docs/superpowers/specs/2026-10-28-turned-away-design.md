# When a website turns us away — design

**Status:** approved by Marko 2026-10-28 in chat ("yes to your recommendations, go ahead, but I won't be choosing a
proxy provider for now"). Branch `feat/turned-away` from `main` @ `126af9cd`, worktree
`C:\Users\Marko\Documents\projects\robot-platform-turnedaway`.

## 1. Why

On Zara (`/my/en/`) two of three proof-page screenshots came back "This website turned us away…" and the third was
fine: the host was pacing us. Today such a capture is `failed` at once, nothing ever tries again on its own (the
worker's per-host backoff only stops the *next* load), the card shows a frozen "Waiting 2 min" sentence cut off at
one line, and every field row repeats "screenshot refused on product 1". The customer cannot tell what happened,
what we are doing, or what they can do.

**Done when:** a turned-away proof page is retried on its own along the ladder below, the customer watches it happen
(state, countdown, try N of 4), a page that recovers needs no click, one that never does ends in one clear sentence
with two actions, a fallback proxy (when one is configured) is tried and kept when it works, and staff see websites
that keep turning us away in ops.

## 2. Decisions (Marko, 2026-10-28)

1. Four tries in all. Direct waits 2, 4 and 8 minutes (about 14 minutes); with a fallback proxy the ladder is
   shorter (§3.2).
2. The customer reads the website's own name ("Zara turned us away"), never a host.
3. Staff see a flag in ops, so "We've told our team" is true.
4. **Swap product** removes the card and opens the product picker (Find products).
5. A website that loads through the fallback proxy after being turned away **keeps** it for all later page loads
   (proof pages, checks, runs). Staff see the automatic switch and can undo it.
6. No proxy provider is chosen now. With no fallback proxy configured the ladder is all direct and the ops flag says
   the website may need a proxy.
7. Customer copy never says "proxy", "IP", a host or an HTTP code (CLAUDE.md, Customer copy). A proxy try reads
   "Trying another way in".

## 3. The design

### 3.1 A new capture state: `waiting`

`ProofPageMeta` gains:

```ts
| { kind: 'proof-page'; status: 'waiting'; url: string; startedAt: string; firstStartedAt: string;
    error: string;                 // the wall's stored sentence (as today's failed row)
    verdict: CaptureVerdict | { kind: CaptureErrorKind };
    retryAt: string;               // ISO; when the next try starts
    attempt: number;               // the try that comes next, 2..4
    via: 'direct' | 'fallback' }   // the route the next try takes
```

and the `failed` variant gains optional `attempts?: number`, `firstStartedAt?: string` and `gaveUp?: true` (set only when
the ladder ran out on walls). `captured` and `capturing` gain optional `attempt?: number` and `firstStartedAt?: string`
(the countdown's and the give-up sentence's clock across tries). Rows written before this branch have none of these and
read as today.

`ProofPageCaptureState` (and so `sources.proofPageCapture` / `proofPageCaptures`) gains `status: 'waiting'` with
`retryAt`, `attempt`, `of: 4`, `via`, and on a failed row `gaveUp`, `attempts`, `firstStartedAt`. Customers get `via`
too (it only picks the "another way in" sentence); nothing in any answer names the proxy address.

### 3.2 The ladder

Only a wall counts: a verdict of kind `refused` or `challenge` (a thrown `CaptureProblemError` / `CaptureError` with
that kind, or a successful capture whose verdict is one). Every other failure (not found, timeout, crash, proxy
error, wrong variant) fails the row as today, with no retry.

| Try | Route | Starts |
|---|---|---|
| 1 | the website's route (today's `forWebsite`) | when the customer adds the product (today) |
| 2 | same | 2 min after try 1's wall |
| 3 | **fallback** if available (§3.3), else same | at once if fallback, else 4 min after try 2 |
| 4 | the route of try 3 | 4 min after try 3 if fallback, else 8 min |
| — | — | after try 4's wall: `failed`, `gaveUp: true`, `attempts: 4` |

`retryAt` is never earlier than the end of the host's running backoff for that route (§3.4). A try answered *from the
backoff* (no browser opened) does not count: the row stays `waiting` with the same `attempt` and a `retryAt` at the
backoff's end.

**Scheduling.** On a wall the handler writes the `waiting` row and, in the same transaction, enqueues a new
`proof-page-capture` job for the same `captureId` with `runAfter = retryAt`, key `capture:<id>:<attempt>`, and points
`captures.job_id` at it. `enqueue` gains an optional `runAfter: Date` (its `expires_at` window then starts at
`runAfter`). The handler takes a row in `capturing` **or** `waiting` (it writes `capturing` with the attempt as it
starts); every fence that today checks `status = 'capturing'` also admits `waiting` where it closes or retries a row.
A `waiting` row whose job is gone (not live) and whose `retryAt` is more than `PROOF_PAGE_STALL_MS` past is closed
`failed` / `stalled` by `resolveStalledProofPage`, as a `capturing` row is today.

**Try again** (the customer's button on a given-up or stalled card) starts a new capture exactly as today: a fresh
ladder from try 1. A new capture for a URL (Try again, a reload that re-captures) supersedes a `waiting` row: the
older row's queued job is cancelled and the row is left as it is (the screen reads the newest row per URL, as today).

### 3.3 The fallback route

- New env `FALLBACK_PROXY_URL` (worker; the api-server reads it only for staff's Network panel): same forms and
  checks as `DEFAULT_PROXY_URL` (`checkProxyUrl`, `{country}`, the loopback forwarder for credentials). Never a real
  provider in tests. Documented in CLAUDE.md, `.env.example`, `docker-compose.yml` / `stack.env` passthrough.
- **Available** for a website when: `FALLBACK_PROXY_URL` is set and usable, the website has no own `proxy_url`, no
  `DEFAULT_PROXY_URL` is set (then every load already goes through a proxy and there is no other route), the website
  is not already on the fallback, and a country is known when the address has `{country}`.
- **Country.** The website's `country`; if null, guessed from the address: a first path segment that is a known
  country code (`/my/en/` → `my`, `/de-de/` → `de`), else the host's country-code TLD (`.de`, `.co.uk` → `gb`, `.com.au`
  → `au`), only codes in `@robot/browser`'s `COUNTRIES`. No country and an address with `{country}` → not available.
- `forWebsite(sourceId, session, { via: 'fallback', country })` opens the session with the fallback profile (that
  country's locale and time zone, the fallback proxy); `browserProfileForSource` gains the same option.
- **Kept when it works.** A fallback try whose capture verdict is `ok` (or `wrong-variant`) sets
  `sources.fallback_proxy_at = now()` and, if the website had none, `sources.country` = the country used, in one
  update fenced on `fallback_proxy_at IS NULL AND proxy_url IS NULL`. From then on `buildProfile` resolves: own
  `proxy_url` → `DEFAULT_PROXY_URL` → **`FALLBACK_PROXY_URL` when `fallback_proxy_at` is set** → direct. If
  `FALLBACK_PROXY_URL` is later unset, such a website goes direct again (it is a preference, not an address).
- **Undo.** Staff, inside the customer's org, on Settings → Network (staff): "Switched to the fallback proxy on
  <date> after being turned away · **Go direct again**" → `sources.update({ fallbackProxy: false })` (operators only, as
  `proxyUrl`), clears `fallback_proxy_at`, logged in `staff_actions` as "Set the website to load directly", read by the
  customer as "Changed a setting of this website" (the existing proxy logging path). `sources.get` gives staff
  `fallbackProxyAt`; `networkOf` reports `proxy: 'fallback'` for it.
- Migration `0026`: `sources.fallback_proxy_at timestamptz null`.

### 3.4 Backoff per route

`reportVerdict` / `backoffAnswer` key on `host` for direct loads and `host via fallback` for fallback loads, so a wall
on the direct route never holds back the first fallback try, and the two routes back off on their own. The direct
backoff steps stay 2 min doubling to 8 (they are the ladder's waits).

### 3.5 Ops

- `ops.websites` rows gain `turnedAway: { since: string; gaveUp: boolean } | null`: the newest proof-page capture of
  any of the website's proof-page URLs (its `sources` row's current board URLs, or simply the newest per URL among
  its captures in the last 24 h) is `waiting`, or `failed` with `gaveUp`. And `fallbackProxyAt`.
- The ops websites list shows a badge: "Turned away · retrying" (waiting), "Turned away · may need a proxy" (gave up
  with no fallback configured) or "Turned away even through the proxy" (gave up after fallback tries); and
  "Proxy (automatic)" when `fallbackProxyAt` is set. Ops stays read-only.

### 3.6 The customer screen (Verification tab)

Copy below uses `{name}` = the website's name (`sources.name`, as in the breadcrumb). Staff (`showsMoney`) read the
stored sentence as today plus the route ("via fallback proxy").

- **Capturing** (try 1, or a retry in progress): a spinner, "Taking screenshot… 12 s" counting up from the row's
  `startedAt`; on a retry "Trying again… 4 s" (direct) or "Trying another way in… 4 s" (fallback), with "Try 2 of 4".
- **Waiting:** a clock icon, "{name} turned us away." / "Trying again in 1:42" (mm:ss, live, from `retryAt`) or
  "Trying another way in 0:12" when the next try is fallback / "Try 2 of 4". At 0:00 it reads "Trying now…" until
  the poll shows `capturing`. Action: **Swap product**.
- **Given up:** "We tried 4 times over 15 minutes and {name} kept turning us away. Swap this product for another, or
  try again later. We've told our team." (minutes from `firstStartedAt` to the last try, rounded up, at least 1).
  Actions: **Try again**, **Swap product**. The full sentence wraps (no one-line clamp).
- **Other failures** (not a wall): as today, with the sentence no longer clamped to one line.
- **Swap product:** removes the card (today's ×) and opens Find products, with the website's listing page filled in
  when it has one.
- **The bar.** Above the table, when any of the first three cards is waiting or given up on a wall: one line, e.g.
  "{name} turned us away on products 1 and 2. We're trying again on our own, next in 1:42. You can keep working on
  product 3." (given up: "{name} kept turning us away on product 1. Swap it for another product, or try again
  later."). One bar, not one per card.
- **Rows.** `rowStatus` reads "waiting for product N" for a waiting (or capturing retry) card and "turned away on
  product N" for a given-up one, in place of "screenshot refused on product N" / "human check on product N".
- **Polling.** The per-capture poll keeps polling while `capturing` (2 s) and polls every 5 s while `waiting`; the
  countdown ticks every second on the client from `retryAt` (one shared 1 s ticker per tab).

## 4. Safety

- Free: no AI; the fallback proxy is never a real provider in tests or live checks (the recording proxy fixture).
- A retry never runs after its row was superseded or closed (fenced writes, cancelled jobs).
- Nothing in a customer answer names the proxy; the address stays staff-only and masked.
- Deleting a website still cancels its jobs (`cancelWebsiteJobs`), the queued retries included.

## 5. Testing

- **Unit (api):** the ladder table (each try's route and wait, with and without a fallback, a backoff answer not
  counting, give-up after 4); fallback availability (own proxy, default proxy, already switched, `{country}` with no
  country); the country guess; the switch is written once and only on an ok fallback capture; `buildProfile`'s new
  precedence; stalled `waiting` rows; a superseded row's job cancelled; per-route backoff keys.
- **API:** `proofPageCapture` / `proofPageCaptures` shapes for waiting and given-up rows, no proxy in a customer
  answer; `sources.update({ fallbackProxy:false })` operator-only and logged; `ops.websites` flags; the isolation
  classification unchanged (no new procedure) or updated if one is added.
- **App (unit):** the card states (capturing timer, waiting countdown, trying now, given up), the bar text for 1/2/3
  products and given-up, `rowStatus` wording, Swap product, customer vs staff wording, no "proxy" in customer copy
  (the copy sweep).
- **Route smoke:** its wall step reads the new waiting card instead of "Waiting 2 min" (it asserts the state and the
  countdown text shape, then removes the card).
- **Live check (free):** `packages/worker/src/live-turned-away.ts`: a throwaway database, an in-process worker, a
  local fixture shop whose product page answers a wall (403 with a denial page) to direct requests for the first N
  loads, and the recording proxy fixture as `FALLBACK_PROXY_URL` that the fixture lets through. Short waits via
  `ROBOT_BACKOFF_FIRST_MS` / a ladder override env for the check only. Proves: direct walls → waiting rows with
  growing `retryAt` → fallback try → captured; `fallback_proxy_at` set and the next capture goes through the proxy;
  with no fallback: four walls → given up. Writes `docs/testing/results/2026-10-28-turned-away/`. Plus screenshots of
  the card and bar states from the isolated pair, looked at.

## 6. Not in this spec

- Choosing a proxy provider (Marko, later).
- Retrying walls for runs, checks, the listing finder or reachability (they keep today's behaviour).
- Customer-chosen countries or proxies.
- Notifying staff by email (the ops flag is the notice).
