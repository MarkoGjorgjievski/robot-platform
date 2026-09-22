// packages/dashboard/src/lib/probe-evidence.ts
// The confirm gate's evidence summary (mvp-simplification task 10, spec §3
// step 2: "the run presents its evidence — pages walked, pagination
// strategy, detail URLs found"). Pure — takes the work-list counts
// `crawl.items` already returns plus the run's parsed warnings
// (`parseRunLog`), and returns plain data so it can be unit-tested without a
// tRPC client or a DOM.
//
// Pagination strategy is a best effort, not a guarantee: `plan-run.ts` only
// ever names the strategy inside a WARNING (`pagination (${source}: ${strategy})
// ...`), and only on the two paths worth warning about — zero gain or a thin
// walk (see plan-run.ts, "pagination (...) produced no new items" /
// "pagination (...) gained only N new item(s)"). A clean multi-page walk logs
// nothing naming its strategy at all, so "not reported" is the honest answer
// there — it is what the run's own data says, not a guess.

export type ProbeEvidenceInput = {
  counts: { listing: number; detail: number };
  warnings: string[];
};

export type ProbeEvidence = {
  /** Listing pages walked — `crawl.items`' `counts.listing`. */
  pagesWalked: number;
  /** Detail URLs found (and, for a probe, sampled) — `counts.detail`. */
  itemsFound: number;
  warningsCount: number;
  /** Best-effort strategy name from the run's own warnings, or a fallback. */
  paginationNote: string;
};

// Source: packages/scraper/src/crawl/plan-run.ts —
// `pagination (${winningSource}: ${winning.strategy}) produced no new items ...`
// and `pagination (${winningSource}: ${winning.strategy}) gained only ...`.
const PAGINATION_STRATEGY = /pagination \(([^)]+)\)/i;

// Source: packages/scraper/src/crawl/plan-run.ts —
// `no pagination detected on ${start.url} — planned page 1 only`.
const NO_PAGINATION = /no pagination detected/i;

export function probeEvidence({ counts, warnings }: ProbeEvidenceInput): ProbeEvidence {
  const strategyWarning = warnings.find((w) => PAGINATION_STRATEGY.test(w));
  const strategyMatch = strategyWarning ? PAGINATION_STRATEGY.exec(strategyWarning) : null;
  const noPagination = warnings.some((w) => NO_PAGINATION.test(w));

  const paginationNote = strategyMatch
    ? strategyMatch[1]!
    : noPagination
      ? 'none detected — single page'
      : 'not reported';

  return {
    pagesWalked: counts.listing,
    itemsFound: counts.detail,
    warningsCount: warnings.length,
    paginationNote,
  };
}
