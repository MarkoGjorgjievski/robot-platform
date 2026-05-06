# Field-Aware Extraction Design

## Problem

Today the AI discovers fields blindly — it reports whatever it finds on a page. But customers typically arrive with a specific list of fields they need. If the AI finds 8 fields but the customer needed 16, there's no mechanism for user requirements to steer extraction. And if 4 of those 8 aren't needed, they're noise.

## Design

### Field Model — Two Tiers

Every field in extraction results is classified:

- **Requested** — user explicitly asked for this field. Highest priority in extraction, shown with clear found/not-found status.
- **Discovered** — AI found this on the page, user didn't ask for it. Shown separately. User can promote to requested.

Each field carries:
- `name` — normalized by AI (e.g., user says "shipping weight" → `shipping_weight`)
- `type` — inferred or explicit (`string`, `number`, `price`, `url`, etc.)
- `description` — what this field represents
- `tier` — `"requested"` or `"discovered"`
- `status` — `"found"` | `"not_found"` | `"uncertain"` (post-extraction)
- `notFoundReason` — when not_found, AI explains why (e.g., "page does not contain shipping weight information")

Tier is per-source, not per-domain. The domain cache stores extraction paths without tier awareness — all customers see all cached fields as discovered until they promote them.

### Three Entry Paths

All converge at the same extraction pipeline and results view.

**Path 1: Cached Domain**
User enters a URL for a known domain. Before extraction runs, show the list of fields we can extract (from `domain_intelligence`). User selects which they want (become requested), adds any extra fields, hits extract. Nearly free — cached paths resolve without AI.

**Path 2: User Has Fields**
User enters a URL + types desired fields upfront (freeform text). AI normalizes input into structured fields during analyze step. Extraction runs with those as requested, returns two-tier results.

**Path 3: Exploring**
User enters just a URL, no fields. AI discovers everything it can. All fields come back as discovered. User promotes fields to requested, adds new ones, re-extracts.

### How User Fields Steer the AI

When requested fields are provided, the extraction chain behavior changes:

1. **Mechanical extraction** — field alias matching expanded using user's field descriptions. "Shipping weight" matches `weight`, `shipping_weight`, `package_weight` in API JSON.

2. **AI API analysis** — Claude receives the requested field list and hunts specifically for them in intercepted API data. Has a checklist to work through, not just reporting what it notices.

3. **AI XPath generation** — Claude targets requested fields first, then adds selectors for anything else on the page.

The extraction chain order is unchanged (mechanical → cached → AI API → AI XPath). Every step now knows what it's looking for.

Cost impact: minimal. Prompt is slightly longer but we avoid expensive re-extraction runs because the AI gets it right more often on the first pass.

### Results Display

**Requested fields** shown with found/not-found status. Not-found fields include AI explanation of why.

**Discovered fields** shown below with option to promote to requested.

When user entered no fields (Path 3), everything shows as discovered. Once the user promotes any fields, the view splits into two tiers.

### Post-Extraction Refinement

**Add fields** — user types new field names, batched together. Re-extract targets only new fields. Previous results kept. New fields become requested.

**Remove fields** — fields disappear from this source's results. No re-extraction needed. Domain cache retains the extraction paths for other customers.

**Promote discovered** — one click moves a discovered field to requested. Prioritized and tracked in future runs.

**Not-found requested fields** — two options:
- Manual selector — click-to-select on page to provide XPath
- Deep search (opt-in toggle) — AI tries harder with alternative strategies and suggestions (e.g., "no shipping_weight, but found product_weight — is that it?"). Higher token cost.

**Re-extraction is incremental.** Mechanical and cached results kept. AI only runs for new requested fields that don't have values.

### Schema Persistence

**Source level** — stores field configuration: which fields are requested, which discovered fields user promoted. Drives extraction for future runs of this source.

**Collection level** — schema is the union of fields across sources. When a customer defines fields for a collection, new sources inherit those as requested automatically.

**Domain cache level** — stores extraction paths (API dot-notation, XPaths) with hit/miss stats. No tiers — just "we can extract these fields from this domain." Shared across all customers.

**New source in existing collection:**
1. Collection has schema: `[title, price, sku, stock_status]`
2. User adds new source URL for a cached domain
3. System pre-fills: collection fields as requested + cached domain fields as discovered
4. User adjusts fields, runs extraction
5. Source saves its final field configuration

Collection schemas act as templates — new sources start with the customer's requirements without re-entering them.
