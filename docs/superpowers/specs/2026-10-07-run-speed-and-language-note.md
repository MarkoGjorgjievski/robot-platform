# Run speed: where a certified run's time goes, four levers, and the language question — note

**Status:** discussed 2026-10-07. Marko's decisions: levers 1 and 2 are to be
implemented **soon, not now** (after the current next-work list in
`docs/handoff.md`); lever 3 is deferred until its one unknown is measured;
lever 4 does not apply to extraction runs; **no rewrite in Go or Rust.**
Nothing here is built. Builds on
`2026-09-11-lean-capture-for-certified-runs-design.md`, whose first increment
landed 2026-09-15 and whose measurements this note uses.

## The question that started it

People keep proposing to move projects like this one to Go or Rust because
they are faster, and in the AI era some argue that even lower-level code is
fine because agents write and review it anyway. Would rewriting part of this
platform in a lower-level language give an immense speed difference?

**No.** The argument is right for CPU-bound, memory-heavy, hot-loop code
(parsers, databases, proxies, serialisation), where 5–50x is real. It is wrong
for I/O-bound orchestration, which is what this codebase is. A Rust program
that awaits a page load, a Claude call or a Postgres round trip finishes at
exactly the same moment a Node program does. Language choice only speeds up
the slice of wall time our own code is on the CPU; Amdahl's law caps the gain
at that slice.

In a certified run that slice is milliseconds per product (the certified
paths are evaluated in-page by Chromium's own C++ XPath engine via
`page.evaluate`; our TypeScript builds rows and writes them). Measured per
product on Ikea (2026-09-15): 10.5 s, of which under 0.1 s is our code.
Rewriting the orchestrator in Rust would buy under 1%, and would cost the
end-to-end tRPC types between API and app, Drizzle, Playwright's first-class
Node API, and the fact that `@robot/app` has to stay TypeScript regardless.

The "AI writes it anyway" point also skips three things that still matter:
a human reads the code when it breaks; the ecosystem we lean on may not exist
in the other language; and borrow-checker and compile cycles cost agent turns
too.

Where a lower-level piece *could* eventually pay: if lever 3 below grows into
a high-volume fetch-and-parse crawler with no browser at all, at tens of
thousands of pages a minute, a Rust or Go fetcher plus HTML parser as a small
sidecar or native module is genuinely lighter than Node. That is a future,
measured decision, not a rewrite.

## Where one product's 10.5 s goes today (measured, Ikea, certified run)

| Stage | Time | Notes |
|---|---|---|
| Navigate, `waitUntil: 'load'` + ready check | 2.3–3.8 s | real network and render; the ready check passed on the first poll on all 10 products |
| Popup rounds (`dismissPopups`) | ~4 s | a fixed 1.5 s sleep, then up to 3 rounds with 800 ms after a click and 500 ms after JS removal |
| Expand hidden content | ~0.5 s | 500 ms pauses, tab clicks up to 3 s |
| Screenshots + markdown | ~0.7 s | built for Claude, which never runs on a certified website |
| Second render for the XPaths (`setContentEvaluate`), stats, row writes | ~2.5 s | |
| Our TypeScript on the CPU | < 0.1 s | the only part a language change touches |

The 2 s politeness spacing (`POLITENESS_DELAY_MS` in
`packages/scraper/src/domain-lock.ts`) is measured from the previous
*release* to the next *acquire*, so it adds nothing while a product takes
longer than 2 s. It becomes the floor only once a product is faster than that
(lever 3). The certified path takes the lock since 2026-09-15.

## A hypothetical large run

20 customer websites, 50 detail pages each, 1,000 pages, all sources
certified (so zero Claude calls per page), executed as 20 runs. Today
`execute-run.ts` is one item at a time per run, and nothing runs two runs at
once on purpose. Per-product numbers after "today" are estimates, not
measurements.

| Step | Per product | Whole run | What changed |
|---|---|---|---|
| Today (measured) | 10.5 s | ~2 h 55 min | |
| 1. Lean capture, second increment | ~4 s | ~1 h 07 min | no popup/expand rounds, no screenshots or markdown, XPaths run in the live tab; fallback to the full capture on a miss |
| 2. Eight websites in parallel | ~4 s | ~10 min | 20 runs over 8 lanes is 3 waves of 50 × 4 s |
| 3. Fetch mode for ~60% of websites | 2 s fetch (politeness floor), 4 s browser | ~4–5 min | fetch-mode sources need no browser lane, so the browser lanes serve only the remaining websites |
| 4. LLM trimming | no change | | a certified run makes no per-page model call |

Levers 1 and 2 alone: about 2 h 55 min to about 10 min, roughly 17x, with
the extraction semantics unchanged. Lever 3 adds the last step and is the
only one that touches the architecture.

**The floor after all of it.** 50 pages × 2 s politeness = 100 s per
website, whatever else is done. With enough lanes the whole run is bounded by
the slowest website's 100 s plus the browser-mode websites' 200 s. The next
lever after that is policy, not code: honour a site's robots crawl-delay when
declared, and allow shorter spacing for hosts that respond fast. That is
Marko's call, since it is about how polite we are to customers' target sites.

## Lever 1 — lean capture, second increment (soon, not now)

Already designed: items 2–4 of
`2026-09-11-lean-capture-for-certified-runs-design.md` (the XPath probe runs
in the live tab so the second render goes away; the popup, expand, screenshot
and markdown steps are skipped; a miss falls back to today's exact full
capture; three rescued misses in a row switch the rest of the run to full).
Nothing to redesign. The risk it carries — a certified value that appears
only after a "show more" click — is covered by the fallback.

A related, smaller item for the *full* capture (verification and the AI
chain, few pages): the fixed sleeps in `dismissPopups` could become
event-based waits (resolve when an overlay appears or the DOM has been quiet
for ~200 ms; after a click, wait for the element to detach rather than
800 ms). Pure fix, no semantic change, one file
(`packages/browser/src/playwright-browser.ts`). Low priority because
certified runs will not take that path at all after lever 1.

## Lever 2 — websites in parallel (soon, not now; needs a short design)

Politeness is per host, so running different websites at once breaks no
promise to any site. The pieces:

- **A run scheduler / queue** that executes up to N runs at once, each still
  one item at a time (`execute-run.ts` stays sequential per run; its header
  comment is right about same-domain work). The roadmap's "a real job queue"
  item (an api-server restart still pauses a run) is the same piece of work
  and should be designed together with this.
- **One Chromium, one context per page, a cap on open pages.** Each open
  page costs roughly 100–150 MB and a share of CPU for rendering. Start with
  8 lanes on the dev machine; measure before raising it.
- **Lock scope.** `acquireDomainLock` is in-memory per process. Fine while one
  api-server process executes every run; if execution ever spreads across
  processes, the lock and the last-request time move to Postgres.
- **Two runs on the same host** (two websites of one customer on one domain,
  or two customers on the same marketplace) share the lock automatically and
  simply serialise. No special case needed.
- **Plan phase.** `plan-run.ts` is also sequential per input under the lock;
  the same scheduler covers it.

Not in scope: parallel tabs on one website. The 2 s spacing makes that
pointless (at most 0.5 requests/s per host).

## Lever 3 — skip Chromium where it is not needed (deferred)

**What it is.** Not removing Chromium; not launching it for pages that do not
need rendering. A plain fetch downloads one HTML document in a few hundred
milliseconds. Chromium downloads that plus every script, stylesheet, font and
image, executes the JavaScript, runs layout and waits for the network to go
quiet. Two of the extraction chain's steps never look at the rendered DOM:
JSON-LD and meta tags are in the raw HTML, and a cached API path replays
against JSON that the browser only ever served as a way to discover the
endpoint. A certified source whose paths are all of that kind pays for a DOM
nobody reads.

**Granularity.** Every field is read from one capture of one page, so if any
certified path on a page needs the rendered DOM, that page is rendered and all
fields read from it. The decision is per page and in practice per source: one
XPath-only field keeps the whole source in browser mode. Two escape hatches:
a field can hold several certified paths, so an XPath field that also has a
certified API or JSON-LD path qualifies; and a field can be certified a second
way later. Chromium itself is per page, not per source — if 5% of a run's
pages need rendering, only they pay for it; the browser process stays alive
and idle costs almost nothing. What cannot be done is splitting one source's
pages between the two modes.

**How it would be decided.** At certification time, not per run. Verification
already loads the proof pages in Chromium; also fetch the raw HTML and call
the intercepted endpoint directly, and check that every certified path
resolves from those alone with the same values on every proof page. If yes
the source is certified fetch-mode; otherwise browser-mode. A fetch-mode miss
at run time falls back to a browser capture for that page. The customer-facing
contract does not change.

**Caveats, in order of how much they touch existing rules:**

1. **Misses become ambiguous.** Today a miss on a certified path means the
   value is absent on that page. In fetch mode it can also mean the raw HTML
   differed from the rendered DOM. The only safe reaction is to fall back to
   the browser on any miss, so pages where the value is genuinely absent pay
   the browser cost anyway. Eats into the gain on sources with sparse fields.
2. **Hit/miss stats must stay separate.** The prune rule drops a path at ≥5
   uses and ≤10% hits. A fetch-mode miss that the browser then resolves must
   not count against the path, or fetch mode will slowly prune healthy paths.
3. **Listing pages stay on the browser.** Load-more, infinite scroll and
   pagination detection need a live page. Fetch mode is for detail pages.
4. **Replaying an API endpoint is not fetching HTML.** The browser sent
   headers, cookies and sometimes a signed token. A direct call needs those
   stored and refreshed; an expiring token becomes a wave of misses with no
   obvious cause. Certification should record the exact request that
   succeeded without a session, or not certify fetch mode for that field.
5. **Raw HTML can differ from what the browser saw.** Tag managers inject
   JSON-LD at runtime; content varies by geo, A/B bucket or consent state.
   Fetch-mode certification must compare fetched HTML against the rendered
   DOM on all proof pages, never assume they match.
6. **Anti-bot can punish both lanes.** A blocked plain fetch is a miss; a
   plain fetch that gets the IP flagged then hurts the browser capture that
   falls back to it. Needs a per-host kill switch after repeated challenges.
7. **Fetch mode needs its own drift signal.** A source certified fetch-mode
   may start hydrating client-side later. A rising fallback rate should flag
   the source for re-verification, as certified-path degradation is flagged
   today.

**The one unknown that decides whether it is worth it:** what share of
customer websites are fully fetchable (every certified path resolvable from
raw HTML or a session-free API call). The 60% in the table above is a guess.
Measure it against the real corpus before planning around it. At the
hypothetical size above, lever 3 saves memory and lanes more than wall clock;
it starts to matter when there are many more websites than lanes, or when
machine memory caps the lanes.

## Lever 4 — fewer and cheaper model calls (not an extraction lever)

A certified run makes zero per-page Claude calls, so this does not move the
run above at all. It matters for setup and verification (schema discovery,
path proposal, judges): prompt caching, Haiku for the cheap steps, fewer round
trips. Record it as cost work, not run-speed work.

## Order of work, when the time comes

1. Lever 1, second increment, exactly as designed in the 2026-09-11 note.
   Re-measure on the same Ikea website (free) for the real before/after.
2. Lever 2, with the job queue. Short design first (spec → plan).
3. Measure the fetchable share of the corpus. Only then decide lever 3.
