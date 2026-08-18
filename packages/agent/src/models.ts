// Single source of truth for Claude model IDs.
//
// Previously each call site hardcoded 'claude-sonnet-4-20250514'. That model has
// since been retired — the API returns 404 not_found_error for it — which took the
// whole agent layer down at once and was invisible until a live call was made.
// Keep model IDs here so a retirement is a one-line change, and so each workload
// can sit on the right cost/capability tier.
//
// Both are overridable by env var for experiments without a code change.

/**
 * Extraction workloads: schema discovery, selector generation, API analysis,
 * variant extraction. Vision + forced tool_use, ~4k output. This is the model the
 * per-URL cost model in docs/project-overview.md is based on.
 *
 * Forced `tool_choice` suppresses thinking on this model — verified against the
 * live API — so the call shape is identical to the retired Sonnet 4 it replaces
 * and no `thinking` parameter is needed.
 */
export const EXTRACTION_MODEL = process.env.ROBOT_EXTRACTION_MODEL ?? 'claude-sonnet-5';

/**
 * Tier 2 dogfood judges. A one-word verdict against a screenshot, max_tokens: 16.
 *
 * Kept on the extraction tier deliberately. Haiku 4.5 was tried here as the cheaper
 * option and calibrated at 7/9 against a controlled page with known answers, versus
 * 9/9 for Sonnet 5. Its two misses were exactly the failure modes that make a judge
 * useless: a false `not-on-page` on `currency: "USD"` (the same bogus verdict
 * cluster seen in the 2026-05-26 and 2026-05-28 reports) and a false `wrong` on a
 * correct SKU. The judge is the measurement instrument for the whole Tier 2
 * harness — a cheaper instrument that invents findings costs more than it saves.
 *
 * Note if you ever move this to a thinking-by-default model at this max_tokens:
 * the budget can be spent entirely on reasoning, leaving no text block, which this
 * code reports as verdict 'error' for every field.
 */
export const JUDGE_MODEL = process.env.ROBOT_JUDGE_MODEL ?? 'claude-sonnet-5';

/**
 * Local Ollama fallback, used when ANTHROPIC_API_KEY is absent.
 *
 * Value is unchanged from when it was inlined in the provider — centralised here
 * so all three model choices live in one file. Not verified recently: Ollama is
 * not installed on the current dev machine, so this path has no live coverage.
 * Treat a change here as untested until someone runs `ollama serve` against it.
 */
export const OLLAMA_MODEL = process.env.ROBOT_OLLAMA_MODEL ?? 'llama3.2-vision';
