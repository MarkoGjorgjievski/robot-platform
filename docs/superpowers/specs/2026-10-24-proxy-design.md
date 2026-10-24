# Proxy support in the browser — design

**Status:** written 2026-10-24 under the standing approval (`CLAUDE.md`, "Autonomous runs"; `docs/queue.md` item 1,
"Proxy support in the browser"). Plan: `docs/superpowers/plans/2026-10-24-proxy.md`. Branch `feat/proxy` from `main`
@ `b2e289dc`, worktree `C:\Users\Marko\Documents\projects\robot-platform-proxy`.

## 1. Why

Some websites refuse our address or show another country's prices. The queue item asks for a proxy and a country per
website, tested against a local proxy.

**Done when:** a capture goes through the configured proxy; tests.

The code audit (2026-10-24) found:

- **One browser per job.** Every job opens one Chromium through `withBrowserSession` (`api/src/browser-session.ts`) →
  `PlaywrightBrowser.launch()`, which makes one `BrowserContext`. No proxy is set anywhere.
- **Per-context proxy needs no launch flag.** Playwright 1.62.1 sends a per-context proxy straight to Chromium from
  `newContext({ proxy })`, so no launch-time flag is needed. Loopback targets also go through it by default, which
  makes a local test possible.
- **Locale and time zone are hardcoded.** Under stealth they are `en-US` / `America/New_York`.
- **Legacy columns are dead.** `sources.country` (always `'us'`), `locale`, `proxyType`, `dataCenter` and
  `projects.proxyPool` are never read.
- **Proxy wording is staff-only.** The customer-copy sweep and `diagnose-run.ts` already keep "proxy" in staff-only
  wording.
- **Every website-scoped page load has its source id in scope.** That covers proof-page capture, Verify, runs,
  planning, transfer marks, variant detection and links-near, drift, coverage and website checks. Reachability and the
  listing check take only a URL, because they run before a website exists.

## 2. The design

### 2.1 What a website carries

`sources.proxy_url text` (nullable) and `sources.country varchar(2)`. The existing `country` column is reused: a
migration makes it nullable and sets the dead `'us'` default rows to null.

- **Proxy URL:** `http://`, `https://` or `socks5://`, optionally with `user:pass@`. It may contain the literal token
  `{country}`, which is replaced with the website's country (lower-case) at use. Most providers select an exit country
  through the username, for example `http://user-country-{country}:pass@gate.provider.com:7000`. This keeps the design
  provider-neutral.
- **Country:** an ISO 3166-1 alpha-2 code from a fixed table of 20 common markets, or null (no preference). The table
  is `browser/src/countries.ts`; each entry is `{ code, name, locale, timezoneId }`, for example `de → de-DE /
  Europe/Berlin`, `gb → en-GB / Europe/London`, `us → en-US / America/New_York`.
- **The env default:** `DEFAULT_PROXY_URL`. A website with no proxy of its own uses it when it is set. It allows one
  provider for everything.
- **Validation at save:**
  - the scheme is one of the three;
  - there is a host and a port;
  - total length is at most 1,000;
  - `{country}` is the only token;
  - no whitespace.

  A refusal is one plain staff sentence, for example "Use an address like http://user:pass@host:port."
- **Storage:** the password lives in plain text in the URL, like the webhook secret. It is never logged: every log line
  and stored error goes through `redactProxy` (the userinfo becomes `***`).

### 2.2 How it reaches the browser

**The profile.** `browserProfileForSource(db, sourceId)` returns `{ proxy?: { server, username?, password? };
locale?; timezoneId? }`, built from the website's proxy URL (or `DEFAULT_PROXY_URL`) with `{country}` replaced, and
from the country's locale and time zone.
- With no country: locale and time zone stay as today (stealth's `en-US` / New York).
- With no proxy: the proxy key is absent, and the browser goes direct as today.

**The browser.**
- `BrowserOptions` gains `proxy`, `locale` and `timezoneId`. `PlaywrightBrowser.launch()` passes them to `newContext`.
  An explicit `locale` / `timezoneId` wins over stealth's defaults.
- `withBrowserSession(fn, opts?)` gains `opts.profile`. Every website-scoped call site in the §1 list looks up the
  profile and passes it.
- Reachability and the listing check stay direct; they run before a website exists. This is noted for staff.
- Staff CLIs (the judge, `jev-images-run`) are unchanged.

**One session per job, one profile per session.**
- No job mixes websites, except the legacy multi-website paths. The audit found none in the worker's jobs; the plan
  confirms.
- A capture through a proxy that fails to connect, or answers 407, gets the verdict `blocked` with the staff sentence
  "The proxy refused the connection." The customer sentence for any blocked page is unchanged (`captureWords`).

**Politeness:** the domain lock stays keyed by host. That is conservative; a per-proxy key is a follow-up.

### 2.3 Who sets it

These are staff-only settings: the proxy is our provider and a cost, and "proxy" is an internal word.

- **The rows.** In staff mode, a website's Settings tab shows a "Network (staff)" section with two rows:
  - **Proxy:** a URL field with the password masked once saved, plus Show, "Use the default" (clears the website's
    own URL) and Save;
  - **Country:** a select from the table, with "No preference".
- **The mutation.** `sources.update` accepts `proxyUrl` and `country` only from an operator, or from staff in staff
  mode. Anyone else gets `FORBIDDEN` for those fields, while the call's other fields still work.
- **What `sources.get` returns.** Staff get `proxyUrl` with the password masked (`http://user:•••@host:port`), a
  `proxyFromDefault: boolean`, and `country`. Customers get neither key.
- **Logging and sweeps.** A staff change is logged in staff words, for example "Set the website's proxy" or "Set the
  website's country to Germany". The customer's log reads "Changed a setting of this website". The money and
  procedure sweeps stay green; the procedure-classes table is unchanged unless a procedure is added.
- **Ops.** The website detail (`/ops/websites/$id`) shows "Network: proxy (own | default | none) · country".

### 2.4 What a customer sees

Nothing new. Prices and pages come from the country staff chose; blocked pages read as today.

## 3. Safety properties

1. A website with a proxy never loads a page directly (no fallback to direct on a proxy failure).
2. A website's proxy credentials never reach a customer, a log or a stored error.
3. A website without a proxy behaves exactly as before, with the same locale and time zone.
4. Reachability and listing checks before a website exists are unchanged.
5. Nothing paid in tests or the live check.

## 4. Testing

- **Unit:**
  - URL validation and the `{country}` substitution;
  - `redactProxy`;
  - the profile builder: own URL, default URL, none, country with no proxy, proxy with no country;
  - the countries table: valid IANA zones and BCP-47 locales, checked with `Intl`.
- **Browser (Chromium, local):** a tiny Node HTTP proxy (`browser/src/__fixtures__/proxy.ts`) that records every
  request (absolute-URI GETs and CONNECT), optionally requires Basic auth, and forwards to a local fixture page.
  - a capture with `proxy` goes through it: the proxy recorded the page URL and the fixture saw the proxy's request;
  - with credentials the proxy gets the right Basic header;
  - wrong credentials give a `blocked` verdict with the staff sentence;
  - with `locale: 'de-DE'` / `timezoneId: 'Europe/Berlin'`, `navigator.language` and
    `Intl.DateTimeFormat().resolvedOptions().timeZone` in the page match;
  - without a proxy nothing goes through it.
- **API:**
  - `sources.update` proxy and country as staff, refused for a customer, other fields unaffected;
  - `sources.get` masking and customer omission;
  - every website-scoped call site passes the profile: a unit test over the call sites with `withBrowserSession`
    mocked, asserting the profile;
  - the staff log sentences.
- **App:** the view function for the Network rows; the copy sweep; the staff smoke shows the section in staff mode.
- **Live check (free, the "done when"):** `packages/worker/src/live-proxy.ts`:
  - **Setup:** a throwaway database, the fixture shop, the local recording proxy with Basic auth, and an in-process
    worker.
  - **Website:** one certified fixture website with `proxyUrl` set to the local proxy and `country: 'de'`.
  - **Run:** a proof-page capture and a small run.
  - **Must see:** every page request in the proxy log, none reaching the shop directly (the shop logs the
    proxy-forwarded marker header), and the captured page reporting `de-DE` / `Europe/Berlin`.

## 5. Not in this spec

- Proxy pools and rotation.
- Per-request proxy switching.
- Provider APIs and health checks.
- Proxies for the pre-website reachability check.
- Per-proxy politeness keys.
- Encrypting the URL at rest.
- A customer-visible country choice. Staff decide; Marko may want customers to pick later (Needs Marko).
