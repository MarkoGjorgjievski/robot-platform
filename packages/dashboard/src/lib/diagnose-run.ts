// packages/dashboard/src/lib/diagnose-run.ts
// The probe-confirm diagnosis panel's pure mapping (mvp-simplification task 8,
// spec §3 step 3): turns the machine evidence a probe run already produces
// into ONE human explanation, in priority order. No fetching, no React — this
// takes plain data and returns plain data so it can be unit-tested without a
// tRPC client or a DOM.
//
// The strings matched below are copied VERBATIM from the pipeline code that
// produces them, each with a comment naming its source file, so a wording
// change over there is a `grep` away from being caught here rather than
// silently going stale.

export type DiagnosisSeverity = 'blocked' | 'wrong-page' | 'pagination' | 'dead-link' | 'extraction';

export type Diagnosis = {
  severity: DiagnosisSeverity;
  title: string;
  detail: string;
};

export type DiagnoseRunInput = {
  warnings: string[];
  errors: Array<{ message: string }>;
  blockedReason?: string | null;
  rowsFound?: number | null;
  itemFailures: Array<{ url: string; error: string | null }>;
};

// Source: packages/scraper/src/extraction-orchestrator.ts —
// `throw new Error(\`Page blocked or unusable: ${health.reason}\`)`, thrown
// whenever `checkPageHealth` (packages/browser/src/page-health.ts) marks a
// captured page unhealthy for ANY reason (bot check, HTTP error page, empty
// page, soft 404). Matched here before the narrower 404/CAPTCHA fragments
// below are even considered — see the severity-order comment on
// `diagnoseRun` for why that's deliberate.
const BLOCKED_PAGE_ERROR = /page blocked or unusable/i;

// Source: packages/browser/src/page-health.ts checkPageHealth — the bot-check
// reason fragments the task brief calls out by name: `'CAPTCHA detected —
// site requires human verification'` and the `'verify you are human'` phrase
// inside the `robot` pattern's `includes` list.
const BLOCKED_HEALTH_REASON = /captcha|verify you are human/i;

// Source: packages/browser/src/page-health.ts checkPageHealth — the 404
// reason fragments: `'HTTP 404 Not Found — page does not exist'` (errorPatterns)
// and the soft-404 reasons, which all say "not found" or carry a bare "404".
const DEAD_LINK_REASON = /404|not found/i;

// Source: packages/scraper/src/crawl/plan-run.ts —
// `warnings.push(\`no pagination detected on ${start.url} — planned page 1 only\`)`,
// pushed once a listing has no pagination config AND the scroll fallback
// gained nothing (the "hub page, or a single-page listing" case).
const NO_PAGINATION_WARNING = /no pagination detected/i;

// Source: packages/scraper/src/crawl/plan-run.ts — the thin-walk warning:
// `\`pagination (...) gained only ${gained} new item(s) on ${start.url} where
// page 1 yielded ${page1Gain}, ... — pages 2+ are likely re-serving page 1;
// the config was not cached, the walk's items are planned\``. Both fragments
// are required so an unrelated warning that merely contains "gained only"
// (there is none today, but the match should stay narrow) doesn't misfire.
const THIN_WALK_GAINED_ONLY = /gained only/i;
const THIN_WALK_RE_SERVING = /re-serving page 1/i;

/**
 * Assembles the machine evidence a probe run already produces into one human
 * explanation — spec §3 step 3's diagnosis panel, in priority order:
 * blocked > wrong-page (0 rows) > pagination > dead-link > extraction.
 *
 * The order is a CASCADE, not a sort: the first category that matches is the
 * whole answer, and lower-priority categories are never even checked. That is
 * what "blocked outranks pagination when both present" means in practice — a
 * page that came back blocked has nothing useful to say about its pagination,
 * and showing both would bury the actionable diagnosis under a symptom of it.
 * `extraction` is the exception: it is the last resort, and per-item failures
 * are reported verbatim, one entry per failed sample row, because there is no
 * single sentence that summarises "these specific URLs failed for these
 * specific reasons" without losing the information an operator needs.
 *
 * A run with none of these symptoms — clean plan, rows found, pagination
 * verified or not needed, no dead links, no item failures — returns [].
 */
export function diagnoseRun(input: DiagnoseRunInput): Diagnosis[] {
  const { warnings, errors, blockedReason, rowsFound, itemFailures } = input;
  const errorMessages = errors.map((e) => e.message);
  const itemErrorMessages = itemFailures
    .map((f) => f.error)
    .filter((e): e is string => e != null);
  const allMessages = [...warnings, ...errorMessages, ...itemErrorMessages];

  // 1. blocked — `blockedReason` (a direct field some callers set from a
  // health check) or a "Page blocked or unusable" / bot-check fragment
  // anywhere in the evidence.
  if (blockedReason) {
    return [{
      severity: 'blocked',
      title: 'Site blocked our requests',
      detail: `${blockedReason} — wait and retry; long-term this needs the proxy line item.`,
    }];
  }
  const blockedMatch = allMessages.find(
    (m) => BLOCKED_PAGE_ERROR.test(m) || BLOCKED_HEALTH_REASON.test(m),
  );
  if (blockedMatch) {
    return [{
      severity: 'blocked',
      title: 'Site blocked our requests',
      detail: `${blockedMatch} — wait and retry; long-term this needs the proxy line item.`,
    }];
  }

  // 2. wrong-page — the listing produced no rows at all. Only an EXPLICIT 0
  // counts; `rowsFound` absent/null means "not reported here", not "zero".
  if (rowsFound === 0) {
    return [{
      severity: 'wrong-page',
      title: 'No rows found',
      detail: 'No product rows on this page — is it really a listing? It may be a detail page or a hub.',
    }];
  }

  // 3. pagination — two distinct sub-cases, each its own machine string, the
  // hub case checked first per the spec's own bullet order.
  const hubWarning = warnings.find((w) => NO_PAGINATION_WARNING.test(w));
  if (hubWarning) {
    const found = rowsFound != null ? String(rowsFound) : 'some';
    return [{
      severity: 'pagination',
      title: 'No pagination found',
      detail: `Found ${found} products but no way to reach more pages — hub page, or a single-page listing.`,
    }];
  }
  const thinWalkWarning = warnings.find(
    (w) => THIN_WALK_GAINED_ONLY.test(w) && THIN_WALK_RE_SERVING.test(w),
  );
  if (thinWalkWarning) {
    return [{
      severity: 'pagination',
      title: 'Pagination looks broken',
      detail: 'Pagination looks broken on this site — pages repeat.',
    }];
  }

  // 4. dead-link — a 404 or "not found" reason in the plan errors or the
  // sample extraction failures.
  const deadLinkMatch = [...errorMessages, ...itemErrorMessages].find((m) => DEAD_LINK_REASON.test(m));
  if (deadLinkMatch) {
    return [{
      severity: 'dead-link',
      title: 'Link appears dead',
      detail: `The link appears dead (${deadLinkMatch}).`,
    }];
  }

  // 5. extraction — the last resort: every sample item that failed, verbatim,
  // one diagnosis entry per item.
  return itemFailures
    .filter((f): f is { url: string; error: string } => f.error != null)
    .map((f) => ({ severity: 'extraction' as const, title: f.url, detail: f.error }));
}
