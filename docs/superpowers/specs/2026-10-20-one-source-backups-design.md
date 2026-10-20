# Backups from more than one source — design

**Status:** written 2026-10-20 under the standing approval (`CLAUDE.md`, "Autonomous runs"; queue
item "Backups that all come from one source"), together with its plan
(`docs/superpowers/plans/2026-10-20-one-source-backups.md`). Every behaviour below was read in the
code on `feat/one-source-backups` @ `dfc9fe1`; line numbers are approximate — find the code by the
quoted text.

## 1. Why

A field certifies with up to five paths, tried in order at scale; the first that reads a value wins.
The later paths are meant to be backups: when the site changes the place the first one reads, the
next one still fills the column. On Ikea they are not. The read-only audit of 2026-09-29
(`docs/testing/2026-09-29-certification-live.md`, "The audit") shows:

| Website | Field | Certified paths |
|---|---|---|
| Acne / Ikea, Competitor prices / Ikea | Price | `api price`, `api priceExclTax`, `api priceNumeral`, `api priceExclTaxNumeral`, `api revampPrice.integer` |
| Competitor prices / Ikea | Product URL | `api pipUrl`, `api revampPrice.separator`, three `api otherConfigs.theme…` keys |
| Acne / Ikea | Price currency | `api revampPrice.currencyPrefix`, `api revampPrice.currencySymbol` |

All five Price paths are sibling keys of one API response. If Ikea renames that endpoint, moves it,
or stops sending it, all five miss on the same page, and the column empties — although Ikea's
JSON-LD `offers.price` held the same price on every proof page and would have kept it filled. Ops
already shows the symptom ("All backups read the same response — if it changes, they fail
together"), but nothing changes it: certification ranks every API path above every JSON-LD path, so
five API siblings fill all five places before JSON-LD gets one.

## 2. What happens today

- **Ranking and the cap.** `rankCertified` (`packages/scraper/src/verify/certify.ts:~35`) sorts by
  source (`SOURCE_RANK`: api 0, json-ld 1, meta 2, xpath 3), then path length (a `[page]` step counts
  as `[0]`, spec 2026-10-14 §4), then `[page]` before its fixed-index twin. `rankConfirmedFirst`
  (`:~71`) puts the paths the customer confirmed first (spec 2026-09-29 C1). When one path set reads
  every proof page ("one layout"), the result is `rank(oneLayoutPool).slice(0, MAX_CERTIFIED_PATHS)`
  (`:~325`; `MAX_CERTIFIED_PATHS = 5`, `verify/constants.ts`). Nothing looks at where a path reads
  from.
- **Covers.** When no single path reads every page, `greedyCover` (`:~170`) picks the fewest safe
  paths that together cover the pages (a common layout plus exceptions); it adds no backups.
- **What an API path is.** A certified API path is a dot path only (`CertifiedPath = { source, path,
  transform, provenOn? }`, `verify/types.ts:~56`). It does **not** name the response it was found in.
  `resolveStructured` (`verify/search-structured.ts:~128`) tries it against every intercepted JSON
  body in capture order and returns the first non-empty value; candidate search walks every body the
  same way (`:~63`). JSON-LD paths are resolved the same way over the page's JSON-LD blocks; a meta
  path is a meta tag's name; an XPath reads the page's HTML.
- **Extraction** (`verify/verified-extraction.ts:~135`): the certified paths in stored order; the
  first that reads a value fills the cell; the rest are not evaluated (`break`). A field is empty
  only when every path misses.
- **Drift** (`packages/api/src/crawl/drift.ts`): a field drifts when at least 20 % of a run's rows (5
  rows or more) leave it empty — so only when every certified path misses. One-source backups miss
  together, so today a renamed Ikea endpoint means an empty Price column and a drift episode;
  `drift-classify.ts` then re-certifies from the old paths plus fresh candidates.
- **The domain-cache shortcut** (`verify/run-verification.ts:~187`): when the domain's store of
  verified paths (`lookupVerifiedPaths`) holds paths for the field's concept, certify runs on those
  alone; if that certifies — and rests on no volatile XPath and no fixed variant index on a
  named-variant page — the search is skipped. On Ikea the store holds the five API siblings, so a
  re-verify certifies them again and never even looks at JSON-LD.
- **The store's cap** (`packages/scraper/src/domain-cache.ts:~1150`): at most `MAX_CERTIFIED_PATHS`
  verified paths per concept, best hit rate first (a path with no uses counts as 100 %).
- **Ops** (`packages/app/src/lib/ops-view.ts:~247`, `oneSourceWarning`): warns when a field has two or
  more paths and they are all `api` (unless two different `container`s are recorded) or all
  `json-ld`. `packages/api/src/routers/ops.ts:~283` never sets `container` ("nothing today records
  that reliably"), so every all-API field warns. All-meta and all-XPath fields never warn.

## 3. The rule

**A field's certified paths come from as many sources as the proof pages offer: at most
`MAX_PATHS_PER_SOURCE` = 2 paths from any one source, at most `MAX_CERTIFIED_PATHS` = 5 in all.**
The order is: the best path first (exactly today's first path), then the best path of each other
source, then each source's second path. What certifies a *field* does not change — only which of
its correct paths are kept as backups, and their order after the first.

### 3.1 What counts as one source

| Kind | One source is | Why |
|---|---|---|
| `api` | one intercepted JSON response, named by its address's origin and path (`https://www.ikea.com/my/en/products/1.json`), query and fragment ignored | The query carries product ids, cache-busters and options (`?itemNos=80275887&expand=…`), and the same endpoint called with a different query is still the same endpoint: it changes, moves or disappears as one. Several GraphQL operations behind one `/graphql` therefore count as one source — the conservative side: it can only spread backups further. |
| `json-ld` | all of the page's JSON-LD blocks together | A stored JSON-LD path, like an API path, names no block (it reads the first block where it resolves), and a site's blocks come from one template or SEO plugin that changes as one. |
| `meta` | all of the page's meta tags together | One `<head>` template. |
| `xpath` | the page's HTML | Two XPaths into one page fail together on a redesign, however different their anchors. |

**Which response an API path reads.** On a proof page, an API path reads the response
`resolveStructured` would take its value from: the first JSON body, in capture order, where the path
resolves to a non-empty value. That address, without query and fragment, is the path's response on
that page. Two API paths are **one source** when, on some proof page they both read, they read the
same response. The source's name (its `container`) is the response the best-ranked of them reads on
the first proof page it reads anything on. Comparing on the same page is what makes this work when a
product id sits in the address's path (`/products/1.json`, `/products/2.json`): siblings read the same
body on each page, whatever its address. Two API paths that never read a common page count as two
sources (only possible with a default, where a path may read only some pages; rare, and it errs
towards keeping a backup).

### 3.2 Order and cap

From the ranked list (`rankConfirmedFirst`, unchanged):

1. Every path the customer confirmed stays, first, in rank order, as today (spec 2026-09-29 C1). A
   confirmed path is never dropped by the per-source cap; it counts toward its source's two.
2. Then rounds over the rest, in rank order: round 1 takes the best remaining path of every source
   that has fewer than one path so far; round 2 takes the next of every source that has fewer than
   two.
3. The first five are kept.

Ikea's Price (§1) becomes `api price`, `json-ld offers.price`, `api priceExclTax` (whichever sibling
ranks second); with a meta price on the page, `meta product:price:amount` comes third, before the
second API sibling.

**Only one source on the pages** (a site with no structured data: XPaths only; or one API response
and nothing else): its two best paths are kept, and ops keeps its warning for that field — then, and
only then, the warning is true and nothing certification can do changes it.

**Covers are unchanged.** A cover's paths each carry pages no other path carries (a second layout);
none is a backup, so the per-source cap does not apply to them. A cover gets no backups today and
gets none now.

### 3.3 Rules that keep holding

- **The first path is today's first path** — so every cell's found value and path, `thinEvidence`,
  `weakEvidence`, `provenOn`, `defaultOnly`, `notOnWebsite` and every fail reason are what they
  were. Only `certified[1..]` changes.
- **`[page]` first** (spec 2026-10-14 §4): within a source the rank order holds, so a `[page]` path
  still comes before its fixed-index twin. The twin is the same source and takes that source's
  second place when it ranks second there; when a shorter sibling ranks second, the twin is
  dropped (both are correct on every proof page, which is what keeping either requires).
  `verified-extraction.ts`'s `pathsFor` (skip a fixed-index twin on a named page) is unchanged.
- **Confirmed paths are kept and first** (spec 2026-09-29 C1; 2026-10-17 §8: a `[page]` path counts
  as confirmed when its fixed-index twin was).
- **Stable before volatile** (`certify()`): unchanged; the spread applies inside each attempt.
- **Weak fields** (spec 2026-09-29 C2): unchanged; only qualifying candidates reach the spread.

### 3.4 The cache shortcut

A cached certification is kept without a search only if it does **not** read one source with two or
more paths. When it does (Ikea's five siblings, now cut to two), Verify searches the proof pages as
it would on a first Verify — free, no AI: the AI is asked only when nothing certifies — and certifies
over the cached paths plus what the search finds. If the search finds no other source, the result is
the same two paths. Cost: the DOM search, a few seconds per such field per Verify; a field whose
pages really have one source pays it on every Verify.

### 3.5 What is stored

`CertifiedPath` gains `container?: string`: on an API path only, the name of its source (§3.1).
Certify sets it on every certified API path (one layout and cover alike) from the proof pages it
just evaluated. Ignored by extraction, by path identity (`pathId`, `sameVerified`) and by the domain
store, which keeps `(origin, path, transform)` as today. A result written before this change has no
`container`; ops reads such a field as it does today (§4).

No migration: results are jsonb.

## 4. What a customer and staff see

**Customers:** nothing new. The Verification tab, the run page and the exports do not show backups.
Their columns keep filling when a site changes one source and another still carries the value. The
`container` travels in API answers the app already receives (certified paths) and is never rendered
for a customer.

**Staff (ops, the website page):**
- under each API path, the response it reads, without scheme: `from www.ikea.com/my/en/products/1.json`
  (a path stored before this change shows nothing there);
- the one-source warning ("All backups read the same response — if it changes, they fail together")
  and the collapsed row's "Backups share one source" flag fire when a field has two or more paths and
  all of them are one source by §3.1 — all JSON-LD, all meta, all XPath, or all API with one
  `container` (or none recorded). New: all-meta and all-XPath fields warn too. On a field certified
  after this change the warning means "the pages offer only this one source"; on an older result it
  means what it means today, and stays until the next Verify.

## 5. Existing websites

Nothing is re-certified automatically. A stored result keeps its paths and its order until that
website's next Verify (customer or staff); extraction keeps running them. Ops keeps warning on the
old one-source fields, which is how staff find them. Re-verifying a customer's website is a staff
or customer action, not part of this change.

## 6. Safety properties

1. A field certifies on a set of proof pages after this change iff it did before; its cells are the
   same.
2. For the same candidates, `certified[0]` is the same path as before. (A Verify that §3.4 sends
   past the cache searches like a first Verify, so its first path is whatever a first Verify would
   rank first — correct on every proof page, as always.)
3. No source holds more than two of a one-layout field's certified paths, except confirmed paths.
4. A field never has more than five certified paths.
5. Every kept path was correct on every proof page (one layout) — the spread only chooses among them.
6. A cover is the same set and order as before.
7. A result without `container` behaves as today everywhere.
8. Nothing a customer sees changes; staff copy is unchanged except the new "from …" line.

## 7. Testing

- Unit (scraper): `apiResponseOf` (the first non-empty body, query ignored, null when none);
  certify on an Ikea-shaped page set (five API siblings, one JSON-LD price → `api`, `json-ld`, `api`,
  every cell unchanged); two API responses and JSON-LD; one source only (two kept); confirmed paths
  beyond two kept and first; the five-path cap across four sources; product ids in the response's
  path still group siblings; `container` stamped on API paths only.
- Unit (scraper, `runVerification`): a cached one-source pair is searched again and gains JSON-LD; a
  cached two-source pair is kept without a search; a single cached path is still kept without one.
- API: ops passes a stored `container` through; a path without one has none.
- App: `oneSourceWarning` for each kind, `responseText`.
- Read-only check on real data: re-certify, on their stored captures, every stored field whose paths
  read one source (Ikea's Price among them), free and without writing anything; record before/after.
- Route smoke on the isolated pair (app and API changed).

## 8. Not in this spec

- Making extraction read an API path from its own response (it still takes the first body where the
  path resolves).
- Spreading the domain store's own five-path cap by source.
- Junk backups that are correct by coincidence (Ikea's Product URL on theme colours, which `473e7e2`
  stops at the next Verify; positional JSON-LD on B&N): what may certify is spec 2026-09-29's
  business; this spec only spreads what does.
- Re-verifying existing websites; a customer-facing prompt to do so.
- More than two paths from the only source a field has.
