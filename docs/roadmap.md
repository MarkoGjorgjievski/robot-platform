---
name: AI Scraper product roadmap and feature backlog
description: Prioritized roadmap — what's done, what's next, organized by release phase
type: project
---

## v1.0 — Core Pipeline (DONE)
- [x] Browser capture with fallback navigation (networkidle → domcontentloaded)
- [x] Popup/consent dismissal (cookie, health consent, modals — 3 rounds)
- [x] JSON-LD / __NEXT_DATA__ / meta tag extraction
- [x] API interception during page load (rank by content signals)
- [x] Schema discovery via Claude (screenshot + markdown + structured data)
- [x] XPath selector generation (listing + detail page modes)
- [x] Sibling-row extraction (following-sibling:: axis)
- [x] Data extraction with XPath executor + plausibility checks
- [x] AI-powered API JSON analysis (Claude reads raw API, returns dot-notation paths)
- [x] Validation via Claude vision
- [x] Dashboard2 with wizard flow (URL → Schema → Preview → Save)
- [x] Dual provider support (Anthropic + Ollama)
- [x] Domain intelligence cache (multi-path per field, OR-logic, hit/miss scoring)
- [x] Cached API path replay (dot-notation traversal, zero AI cost)
- [x] Cached XPath replay (execute stored selectors, zero AI cost)
- [x] Cross-validation between sources (majority wins)
- [x] Auto-pruning dead paths (>10 uses, <10% hit rate)
- [x] Cache degradation flagging (no auto-reset — human review required)
- [x] Hit rate decay (recency-weighted, only penalizes recent misses)
- [x] Blocked/error page detection (403, captcha, Cloudflare, empty pages)
- [x] Per-domain concurrency locks + politeness delay
- [x] Schema evolution detection (new/removed/degraded fields)
- [x] Human override system (click-to-select + manual XPath/API path)
- [x] Human paths saved to global cache with highest priority
- [x] Cache-first source creation (known domains return instant, $0.00)
- [x] Source detail page (data table, schema editor, runs history)
- [x] Domain library page (search, filters, health status, pre-training)
- [x] Domain detail page (fields, paths, APIs, re-validate, reset)
- [x] Brand/TLD grouping (amazon.com → amazon.co.uk cache sharing)
- [x] Value transforms (word-to-number, brand cleanup, whitespace collapse)
- [x] Content-based API ranking (product key counting, penalize UI layout blobs)
- [x] Retry with exponential backoff for transient API errors

## v1.1 — Stability & Polish (NEXT)
- [ ] Fix save flow end-to-end (test thoroughly)
- [ ] Data quality checks (prices > 0, URLs valid, no HTML in text)
- [ ] Fix BBC-style complex listings (custom React components, low row count)
- [ ] Click-to-select for row selector (not just field values)
- [ ] Crop screenshots to viewport before sending to Claude (token savings)
- [ ] Side panel / expandable sections (Amazon reseller data)
- [ ] Per-source browser config (viewport, user agent, cookie injection) — DEFERRED: do with frontend redesign. Backend: add cookie injection to browser, config passthrough in pipeline, browserConfig JSONB column on sources. Frontend: editable on source detail page.

## v2 — Multi-Page & Pagination
- [ ] User selects source type: listing / detail / listing→detail
- [ ] AI auto-detects pagination (Next button, page numbers, infinite scroll)
- [ ] Configurable: N pages / X items / all pages
- [ ] Listing→Detail: follow links from listing to detail pages
- [ ] Input sets (URL lists, category filters, search queries)
- [ ] Progressive confidence (1 → 5 → 20 → 1000 URLs)
- [ ] Batch extraction with progress tracking
- [ ] crawl() method on browser

## v2.1 — Click-to-Select (Manual Fallback)
- [ ] Full 3-step correction flow (type value → click element → confirm path)
- [ ] Visual element picker with XPath generation (id > data-testid > class > positional)
- [ ] Reverse-search (find path to desired value in API/HTML/meta)
- [ ] Auto-generate transform rules from raw text vs desired value

## v3 — Production Scale
- [ ] Public API (POST /extract) — makes it a product
- [ ] Multi-LLM provider support (OpenAI GPT-4o, Gemini Flash, xAI Grok)
- [ ] Task-based provider routing (vision→Claude, large context→Gemini, cheap→GPT-4o-mini)
- [ ] Provider failover (429/529 → auto-switch to next provider)
- [ ] Scheduling (cron-based re-scraping)
- [ ] Change detection + selector health monitoring
- [ ] Proxy pool integration (Bright Data, Oxylabs)
- [ ] Anti-bot stealth (playwright-extra + stealth plugin)
- [ ] CAPTCHA solving service integration
- [ ] Multiple browser engines (Firefox, WebKit)
- [ ] Auth flows (login before scraping)
- [ ] Data export (CSV, JSON, API endpoint, webhooks)
- [ ] Cost tracking per source/customer
- [ ] Rate limiting + robots.txt compliance
- [ ] Pre-training: bulk-run against top 500 sites
- [ ] Multi-tenancy and auth (before external users)

**Why:** Structured roadmap aligned with market analysis. v1.1 focuses on reliability. v2 adds multi-page. v3 is production infrastructure + multi-provider.
**How to apply:** Complete v1.1 (stability) before expanding to v2 (pagination).
