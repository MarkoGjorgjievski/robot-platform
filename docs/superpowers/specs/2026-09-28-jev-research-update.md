> **Status:** research only, 2026-09-28. Follows `2026-09-17-typesafe-evaluation-note.md`. Marko, 2026-09-28: no Jev implementation for now; the design that would use it is `2026-09-28-jev-shadow-checks-design.md` (parked).

# Jev (TypeSafe) — what changed since 2026-09-17, and what is relevant to us

Research date: 2026-09-28. Sources were read with WebSearch/WebFetch. X/Twitter posts came back HTTP 402, so no X post was read directly. Anything marked *(inferred)* is my own conclusion, not a sourced claim.

## Summary

- **The model has not changed.** It is still `jev-1.13.0`, at the same price ($0.042/M input, output free) and the same 64k/32k context. One new alias, `jev-preview`, currently points at `jev-1.13.0`. The models page now also lists **250,000 tokens/s** next to 1,200 req/min, and warns that "rate limits are adjusting dynamically". There is still no batching, streaming, vision or fine-tuning; customisation happens only through `state`, `instructions` and `criteria`, and every account gets the same weights. ([models](https://docs.typesafe.ai/models.md))
- **There are more ways to reach it.** Vercel AI Gateway added it as `typesafe-ai/jev` on 2026-09-16 (AI SDK 7.0.105+ `experimental_evaluate`, with per-request ZDR and no-training options). OpenRouter lists it as `typesafe/jev-1.13`, `jev-latest`, and an unexplained `jev-router`. There are also LangChain `langchain-typesafe` (alpha), Pydantic AI, and an official agent skill. The Python SDK moved to 0.7.x (`response_model`, pydantic). **The JS SDK we would use is still 0.6.0 from 2026-09-15.**
- **The best scraping evidence comes from Zyte (2026-09-21).** Jev worked as a **per-record quality gate** and as a page-type switch. It caught **46 of 59** misaligned descriptions at a 0.5 threshold with zero false positives, scored a 404 page at 0.04 for "is a book", and classified genre **55/59** (a keyword list managed 43/59) for $0.00188 in total. Zyte's verdict: it cannot extract, but it gives a cheap second opinion on every record.
- **Browser builds validate the "Choice over an indexed element table" pattern** for picking the next action or element. jev-ultrafast (Browser Use) runs a Google Flights task in 7.1 s, and the median protocol calls per task fell from 1,092 to 101. A cookie-consent extension picks the "honest" decline button in 156–458 ms for about $0.00003, and all 14 of its fixtures pass. PlayJev wraps Playwright directly.
- **Ranked for us:** (1) per-row output QA / semantic drift; (2) page-type gate (product / listing / blocked / captcha / 404 / consent); (3) popup and consent dismissal; (4) candidate picking to replace the paid Claude API-path step; (5) crawl decisions (product-link and pagination control); (6) cross-site product matching; (7) category and availability normalisation.
- **The new risks are documented and measured.** Prompt injection from page text moves answers: independent studies range from **0.09% to 61.4%** of answers flipped, and an arXiv paper (2026-09-23) found 1.8% of attacks succeed, rising to 3.5% when optimised. The model is nondeterministic near the boundary: 15 different answer sets came back from 50 identical requests, and Zyte saw 2–5 point drift. **Without a "none/other" option, Jev almost never abstains** (0 of 30 out-of-scope inputs flagged). There are counting and sequence weaknesses, and option-order effects on value-laden questions.
- **Operational maturity is about two weeks.** The status page shows 99.826% API uptime, with incidents on 09-20 and 09-24. Since 09-26, Vercel Gateway users have reported that roughly 98% of Jev requests get a 429, with no official answer yet. LangChain's middleware is experimental and has a known ordering bug. TypeSafe publishes no guidance on calibration drift between versions or on pinning.

## What changed since 2026-09-17

| Area | Change | Date | Source |
|---|---|---|---|
| Model | Still `jev-1.13.0` / `jev-latest`. New alias **`jev-preview`**, currently identical to 1.13.0 *(inferred: this is where the next version will land first)* | seen 2026-09-28 | [docs/models](https://docs.typesafe.ai/models.md) |
| Limits | **250,000 tokens/s** listed next to 1,200 req/min; "Rate limits are adjusting dynamically" because of demand. I cannot tell whether the tokens/s figure is new or simply not previously noted | seen 2026-09-28 | [docs/models](https://docs.typesafe.ai/models.md) |
| Limits | Choice allows up to **255 options**; Score takes **2–10 levels**. For documents with more than 255 lines the docs recommend two passes (pick a window, then rank inside it) | docs | [choice](https://docs.typesafe.ai/primitives/choice.md), [api](https://docs.typesafe.ai/api.md), [line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find.md) |
| Pricing | Unchanged: $0.042/M input, output free | — | [docs/models](https://docs.typesafe.ai/models.md) |
| Features | **No** batching, streaming, image input or fine-tuning. "Same weights across all accounts"; adapting it means `state`, `instructions` and `criteria`. English works best; CJK is supported but less accurate | — | [docs/models](https://docs.typesafe.ai/models.md) |
| Latency | 70–500 ms end to end (launch post). The self-consistency cookbook measured 114 ms, against 826 ms–13 s for LLMs | launch post (page dated 09-27) | [blog](https://typesafe.ai/blog/introducing-system-one-models-and-jev), [cookbook](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook.md) |
| Privacy | Not trained on customer requests. **Zero data retention is available for enterprise** (via sales). The Vercel Gateway route supports per-request ZDR and no-training | — | [legal](https://docs.typesafe.ai/legal.md), [Vercel changelog](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway) |
| Documented weaknesses | The jaggedness page now lists literal reading, counting, numeric representations (e.g. hex/RGB), **Score interpolation**, date/time comparison, **indirection (multi-hop)**, large irrelevant state, adversarial content, **structural invariants** (the same question gave 0.22 as a Noul but 0.99 "no" as a Choice, so P(yes) ≠ 1−P(no)), and generation | seen 2026-09-28 | [jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md) |
| Python SDK | 0.7.0 (09-18): msgspec replaced by pydantic, new `response_model`. 0.7.1 (09-21): API key validation. 0.7.2 (09-26): `http2` extra | 09-18 → 09-26 | [py changelog](https://docs.typesafe.ai/sdk/python/changelog.md) |
| JS SDK | **No release since 0.6.0 (2026-09-15)**; npm `latest` is 0.6.0. That release made a breaking change: `Score.criteria` is now an ordered sequence | 09-15 | [npm registry](https://registry.npmjs.org/@typesafe-ai/sdk), [js changelog](https://docs.typesafe.ai/sdk/javascript/changelog.md) |
| Vercel AI Gateway | `typesafe-ai/jev`; AI SDK 7.0.105+ `experimental_evaluate`; Gateway logs and budgets. Vercel calls it the "fastest-adopted model in AI Gateway history" | 09-16 | [changelog](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway), [blog](https://vercel.com/blog/ai-gateway-jev-model-launch) |
| OpenRouter | `typesafe/jev-1.13`, `typesafe/jev-latest`, and **`typesafe/jev-router`**, which I could not document (the page says it speaks Chat Completions) | seen 09-28 | [openrouter](https://openrouter.ai/typesafe) |
| LangChain | `langchain-typesafe` 0.0.1a3: `TypeSafeClassifier` (stable) plus experimental `ModelRouterMiddleware` and `AutoModeMiddleware` (a tool-call risk gate that fails closed and never shows tool output to the classifier) | blog 09-17 | [LangChain blog](https://www.langchain.com/blog/building-a-harness-with-jev), [docs](https://docs.langchain.com/oss/python/integrations/providers/typesafe), [PR #40556](https://github.com/langchain-ai/langchain/pull/40556) |
| Pydantic AI | `pydantic-ai-slim[typesafe]`: structured output with per-field confidence, plus `decision_boolean_threshold` and `decision_route_threshold` settings | seen 09-28 | [pydantic docs](https://pydantic.dev/docs/ai/models/typesafe/) |
| Agent skill | Official `typesafe-ai/skills` for Claude Code and Codex. There is **no official MCP server**; community ones exist (legostin/jev-mcp, itsmostafa/typesafe-mcp) | — | [agent-skill](https://docs.typesafe.ai/agent-skill.md), [jev-mcp](https://github.com/legostin/jev-mcp) |
| Playwright | Community **PlayJev** (TypeScript, MIT, experimental, 12★): Playwright page → numbered accessibility-tree YAML → `check` / `choose` / `rate` / `act` | seen 09-28 | [playjev](https://github.com/filedcom/playjev) |
| Cookbooks / patterns | The docs index now shows entries missing from our 09-17 list: self-consistency (Noul and Choice), parallel questions, **line-by-line search**, **structure recovery**, skill suggestion, classifying RAG passages, **date extraction**, autoresearch feature discovery, **classification using confidence**, the **intent routing** pattern, and a smart-home demo. *I could not confirm when each was added.* | seen 09-28 | [llms.txt](https://docs.typesafe.ai/llms.txt) |

## Builds in the wild

"Verified" means I read the primary repo or page. "Secondary" means only an aggregator or article reported it.

| What | Who | Link | Date | Numbers | Verified |
|---|---|---|---|---|---|
| jev-ultrafast: browser agent; one Choice picks the operation (CLICK / TYPE_TEXT / SELECT / SCROLL / WAIT / DONE / BLOCKED) and the target element index from an indexed DOM table; targets are re-validated against the live DOM | Browser Use (@gregpr07) | [github](https://github.com/browser-use/jev-ultrafast) | 09-16 | Flights ZRH→LON in 7,073 ms; median 9.45 s → 7.09 s (−25%); protocol calls 1,092 → 101; cost ~$0.004 per madewithjev, $0.0039 per secondary sources | Yes (repo); cost is secondary |
| Jev on the WebMCP benchmark: Jev picks the tool, Mercury 2.5 fills the arguments | idan levin | [madewithjev](https://madewithjev.com/builds/webmcp-benchmark) | — | **49/49** tasks with tools vs **25/49** when Jev drove the raw browser; ~112× cheaper than GPT-6 Astra | Secondary (benchmark at webmcp.com) |
| typesafe-cookie-consent: finds overlays, sends text (≤600 chars) and button labels, asks 4 questions (overlay type, decline button, settings layer, interruption), then a rule table acts | @mtropolis_chris | [github](https://github.com/chrisXchen/typesafe-cookie-consent) | — | 156–458 ms, ~$0.00003/request; 14/14 fixtures incl. DE/FR; cross-origin iframes not covered | Yes |
| unclutter: classifies up to 60 candidate elements (ad, promo, newsletter, cookie, social) and hides them above a confidence threshold; learns templates across similar layouts | kitze | [github](https://github.com/kitze/unclutter) | — | none published | Yes |
| PlayJev: Playwright + Jev (`check` / `choose` / `rate` / `act`) | filedcom | [github](https://github.com/filedcom/playjev) | — | 8/8 Stagehand tests, 4/4 WebVoyager smoke | Yes |
| typesafe-computer-use: OCR plus accessibility tree, then one Choice for operation + target; code adds facts such as "actions already tried on this screen" | awlevin | [github](https://github.com/awlevin/typesafe-computer-use) | — | ~$0.0002/step | Yes |
| Zyte: Jev as a scraping QA gate and page-type switch (books.toscrape.com) | Ayan Pahwa, Zyte | [blog](https://www.zyte.com/blog/jev-the-model-that-cannot-write-a-word-and-where-it-fits-in-web-scraping-does-it/) | 09-21 | Shifted descriptions caught 46/59 @0.5 (0 FP), 52/59 @0.7 (1 FP); 404 → 0.04; genre 55/59 vs keywords 43/59 for $0.00188; $0.000033/query vs ~7× for gpt-5.6-luna; 0.92–0.97 s vs 3.8–8.9 s | Yes |
| Entity alignment cookbook: one Score (different / maybe / same) plus 3 field-check Nouls, with no threshold constant | TypeSafe | [cookbook](https://docs.typesafe.ai/cookbooks/entity_alignment.md) | — | 450 pairs → 40 merge / 50 curator / 360 unlinked (no accuracy given) | Yes |
| DocJev: classifies and splits document packets | Jerry Liu | [madewithjev](https://madewithjev.com/builds/docjev) | repo 09-19 | "6× faster than gpt-5.6-luna at equal accuracy" (author's claim) | Secondary |
| 1kpapers: sorts 1,018 papers into 24 topics (summaries by DeepSeek, then a Jev Choice) | Hassan | [madewithjev](https://madewithjev.com/builds/1kpapers) | — | $0.08 for classification (+$3.99 summarising), 256 ms median | Secondary (madewithjev) |
| Internal-link tool: classifies site pages and picks link pairs | Ian Nuttall | [madewithjev](https://madewithjev.com/builds/internal-link-tool) | 09-23 | up to 500 pages | Secondary |
| fast-jev-compaction: two Nouls per tool call ("keep call?", "keep result in full?") | tamaratran | [github](https://github.com/tamaratran/fast-jev-compaction) | — | 25k state limit, 0.5 keep threshold | Yes |
| foreman: agent supervisor; 10 Nouls → CONTINUE / STOP / RETRY / FINISH / ESCALATE, with thresholds of 0.75–0.80 | thruwire | [github](https://github.com/thruwire/foreman) | — | none | Yes |
| Is-the-task-done checker (stop decision) | @cha73066 | [shipwithjev](https://www.shipwithjev.com/builds/is-the-task-done-checker) | 09-22 | none | Secondary |
| langchain-typesafe AutoModeMiddleware | LangChain | [docs](https://docs.langchain.com/oss/python/integrations/providers/typesafe) | 09-17 | — | Yes |
| Classification at volume: 500 emails for $0.035; 724 ads in 40 s for $0.09; 3,282 posts × 8 questions for $0.128 | various | [madewithjev](https://madewithjev.com/) | — | as listed | Secondary |
| 30-repo survey (jev-ultrafast, unclutter, pi-warden tool-call gate, pg-jev, and others) | Sunwood AI Labs | [note.com](https://note.com/sunwood_ai_labs/n/ncdd304204226?hl=en) | 09-20 | star counts | Secondary |

## Use cases for our product, ranked

The general rule, from Zyte and TypeSafe: code finds the candidates and does every exact comparison; Jev only judges the meaning; always include a "none/other" option. Every threshold below has to be set on our own Tier 1 fixtures before use *(inferred)*.

1. **Per-row output QA: semantic drift, meaning wrong values rather than empty ones**
   - **Where it plugs in:** after extraction, on every row. It sits beside the existing ≥20%-empty drift flag.
   - **Question:** several Nouls in one request, e.g. "Is `title` the name of the product this page sells?", "Is `price` this product's selling price (not a shipping, unit or strike-through price)?", "Does `description` describe the product named in `title`?"
   - **State:** the row's field values, URL, page `<title>`, og:title. Keep it small, because irrelevant state degrades answers.
   - **Adds:** a wrong-value drift signal. Today a certified path that starts reading the wrong node goes unnoticed as long as it isn't empty.
   - **Evidence:** Zyte caught 46/59 cross-record misalignments with zero false positives at about $0.000033 per record. The extra questions cost almost nothing ("the marginal question is nearly free").

2. **Page-type gate**
   - **Where it plugs in:** in capture, before extraction and in the crawl loop.
   - **Question:** a Choice over {product, listing, blocked/captcha, not-found, consent-wall, login-wall, other}.
   - **State:** HTTP status, URL, title, meta, and the first N lines of visible text from the box map.
   - **Replaces:** heuristics. It stops us certifying or extracting from junk pages.
   - **Evidence:** Zyte's "pipeline switch"; its 404 page scored 0.04 for "is a book". Zyte's caveat applies: if a status code or regex can answer the question, don't ask the model.

3. **Popup and consent dismissal**
   - **Where it plugs in:** capture, alongside the 3 rounds of click + JS removal.
   - **Question:** Choice "Which button closes or declines without agreeing?" over the overlay's button labels plus "none"; Noul "Does this overlay block the page content?"
   - **State:** overlay text (≤600 chars), button labels, position.
   - **Replaces:** guessing which button to click, and ripping out elements that turn out to be product UI.
   - **Evidence:** typesafe-cookie-consent: 14/14 fixtures, 156–458 ms, about $0.00003. unclutter classifies up to 60 candidates per page. Both are fixture-level; neither reports production rates.

4. **Candidate picker in place of the paid Claude API-path step (5) and for "found in n places"**
   - **Where it plugs in:** chain steps 5 and 6, and the setup-time disambiguation.
   - **Question:** code lists every JSON leaf and box-map node whose value parses as the field's type. A Choice over the candidate IDs (≤255; for more, first pick a window, then rank inside it) asks "Which of these is the product's `price`?" A Noul asks "Is the field present at all?"
   - **State:** the field name plus type, each candidate's path, value and nearby label or key context.
   - **Replaces:** about $0.03–0.05 of Claude per call with about $0.0001 *(inferred from token sizes)*. Claude is called only when confidence is low. Certification still decides what gets stored, so a wrong pick costs nothing beyond a failed proof.
   - **Evidence:** the pre-parsed extraction and line-by-line search cookbooks (218 lines, two passes), and Zyte's advice to "extract options with regex, let Jev pick". **Nobody has published accuracy for this on product pages**, so we would need to measure it on our fixtures.

5. **Crawl decisions**
   - **Where it plugs in:** listing page → pagination → product pages.
   - **Questions:**
     - A Noul per listing link: "Does this link lead to a single product's page?"
     - A Choice over the indexed controls: "Which control loads the next page of results?", with "none, end of listing" as an option.
   - **State:** link text, href path, the neighbouring card's text; for pagination, the indexed control table.
   - **Adds:** cheap pagination discovery on sites where the link and API-parameter heuristics fail.
   - **Evidence:** jev-ultrafast's indexed element table (DONE / BLOCKED options, targets re-validated in the DOM). WebMCP shows a cleaner action space roughly doubles success (25/49 → 49/49). A community agent's fixtures include "show more" pagination ([search result](https://github.com/AbdelStark/awesome-typesafe-jev)).

6. **Cross-website product matching**
   - **Question:** Score {different, related (review), same}, plus Nouls for "same brand?", "same size or variant?". Code shortlists the pairs first (GTIN, brand, tokens).
   - **Evidence:** the entity alignment cookbook (450 pairs → 40 / 50 / 360; accuracy not given); Zyte lists dedup adjudication as a fit. Numeric size and variant comparisons belong in code, because numbers are a documented weakness.

7. **Category and availability normalisation**
   - **Question:** a Choice from the customer's taxonomy (hierarchical classification cookbook for deep trees), with "other" as an option.
   - **Evidence:** Zyte genre 55/59 vs 43/59 for keywords, $0.00188 in total.

8. **Lower value:**
   - Field suggestions at setup: a Noul per candidate field, "Does this page show X?"
   - Request intake routing: the intent-routing pattern.
   - Neither has direct evidence for our domain.

## Risks and limits

- **Prompt injection from page text.** Scraped pages are untrusted state, and the docs say Jev does not treat state as hostile. The measured impact varies widely:
  - arXiv "Decision Hijacking" (2026-09-23, NTU): +0.043 probability shift; attacks succeed 1.8% of the time, 3.5% when optimised adaptively; high-confidence hijacks 0.2% ([arxiv](https://arxiv.org/html/2609.28613v1)).
  - Community studies run from 0.09% of answers flipped (cwhy) through 73.5% accuracy loss from a one-line injected instruction (zkousama) to 61.4% flipped by fluent context (xzx34/JevOut) ([index](https://github.com/Yifan-Lan/awesome-jev-robustness)).
  - Our mitigation *(inferred)*: keep Jev advisory, meaning certification and code checks decide; send short, field-scoped state; never let a Jev verdict alone delete data or skip a site.
- **Nondeterminism.**
  - 15 distinct answer sets came back from 50 identical requests; probabilities shifted by up to 0.13 ([index](https://github.com/Yifan-Lan/awesome-jev-robustness)).
  - Zyte saw borderline answers drift 2–5 points, and advises keeping thresholds away from the 0.4–0.6 band.
  - TypeSafe's own cookbook: 99.2% decision agreement, and labels "can flip inside a single condition, including TypeSafe" ([cookbook](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook.md)).
- **Abstention.** A Choice always returns one of the options: it picked a wrong genre at 1.00 when the right one wasn't offered (Zyte). Without an explicit none option, 0/30 out-of-scope inputs were flagged, and removing the abstain option took KoBBQ accuracy from 0.95 to 0.00.
- **Calibration varies by task.** ECE ran from 0.008 to 0.793 across audits: Noul was underconfident, Choice and Score overconfident; calibration held on CLINC150 but not on Banking77 ([index](https://github.com/Yifan-Lan/awesome-jev-robustness)).
- **Structural invariants.** P(noul) ≠ 1 − P(not-noul) ([jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)).
- **Option order.** The effect is negligible on most tasks, but one audit found +0.37 for the first option on value-laden questions, and one ranking benchmark saw gates break when rows were reordered (40 rows) ([index](https://github.com/Yifan-Lan/awesome-jev-robustness)).
- **Counting and sequences.** One study reports 13.2% accuracy on sequential state and 33.3% on exact counting. This rules out questions like "how many products are on this page" or "is this the 3rd price" *(inferred)*.
- **Operations.**
  - Status page: 99.826% API uptime over 90 days; "elevated API latency" resolved 09-24; console outage 09-20; the longest outage was 59 min on 2026-08-04 ([status](https://status.typesafe.ai)).
  - Since 09-26, Vercel Gateway users see about 98% 429s with `providerAttemptCount: 0` and no official response ([thread](https://community.vercel.com/t/typesafe-ai-jev-requests-shed-with-429-and-providerattemptcount-0-per-team-throttling/49779)). Use the direct API.
  - Rate limits are "adjusting dynamically".
  - **Any Jev step needs a fail-open fallback to today's behaviour** *(inferred)*.
- **Vendor and SDK maturity.**
  - The public launch was 2026-09-15.
  - The JS SDK is behind the Python SDK: it has no `response_model`, and it last broke `Score.criteria` in 0.6.0.
  - LangChain middleware is experimental and has an open issue: a human-in-the-loop edit can swap the tool so that it bypasses AutoMode ([issue #40694](https://github.com/langchain-ai/langchain/issues/40694)).
  - The confidence docs **do not cover version drift, pinning or shadow deployment** ([confidence](https://docs.typesafe.ai/confidence.md)). Pin `jev-1.13.0` rather than `jev-latest` *(inferred)*.
  - JevBench (community) puts Jev 1.13 first at 74.4, but only just ahead of open 4B models (SemIf 73.1). Its accuracy has been disputed on HN ([jevbench](https://github.com/fstandhartinger/jevbench), [HN](https://news.ycombinator.com/item?id=49816019)).
- **Text only.** Our screenshot tiles cannot be used; the box map and text have to carry the signal.

## Claims I could not verify

From the Buzzoni article ([x.com/polydao/status/2103689373774483815](https://x.com/polydao/status/2103689373774483815)). X returned HTTP 402, so **I never read the article itself.**

| Claim | Status |
|---|---|
| "Jev shipped 2026-09-15" | Consistent with the npm 0.6.0 publish, the Zyte post (HN launch 09-15) and the Vercel changelog (09-16) |
| "~100 ms per decision" | The primary source says **70–500 ms**; the self-consistency cookbook measured 114 ms. "~100 ms" is the low end, not the typical figure |
| "Calibration via RLCD" | Confirmed ([models](https://docs.typesafe.ai/models.md), [launch blog](https://typesafe.ai/blog/introducing-system-one-models-and-jev)) |
| jev-ultrafast "Zürich→London in 7.1 s" | Confirmed in the repo (7,073 ms) |
| jev-ultrafast "$0.0039" | Found only in secondary sources; madewithjev says "~$0.004"; the primary X post (gregpr07) was blocked. **Not verified** |
| awlevin's computer-use step chooser | Confirmed (repo, ~$0.0002/step) |
| tamara's session compaction | Confirmed (repo). Star counts disagree: 2,790 in the 09-20 survey vs 7.1k now |
| 1kpapers: 1,018 papers for $0.08 | Found only on madewithjev (secondary). The $0.08 is **Jev only**; summarisation cost another $3.99 |
| langchain-typesafe AutoModeMiddleware | Confirmed |
| "Shadow first, pin the version" | **Not found in TypeSafe docs.** It reads as the author's advice, not vendor guidance (it is sensible advice) |

Other checks:

- Jev-ultrafast's star count is inconsistent between sources (4,891 on 09-20 vs 21,000 on the repo page now).
- `typesafe/jev-router` on OpenRouter is undocumented.
- The dates the new cookbooks were added are unknown.
