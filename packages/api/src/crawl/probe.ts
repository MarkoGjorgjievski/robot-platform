// packages/api/src/crawl/probe.ts
// Constants shared by probe mode: a cheap, single-row planning pass used to
// sanity-check a Source before committing it to a full crawl.

/**
 * The budget substituted for the source's own budget when `crawl.plan` is
 * called with `probe: true`. Deliberately small and fixed — a probe is a
 * quick look, not a scaled-down version of whatever the source happens to be
 * configured with. Same raw jsonb shape `planRun` expects on `source.budget`
 * (see `packages/scraper/src/crawl/budget.ts`'s `resolveBudget`), so it can
 * be threaded straight into the same `planRun` args as a real budget.
 */
export const PROBE_BUDGET = { max_pages: 3, max_items: 30, mode: 'first_n' } as const;

/**
 * How many claimed items a probe run's `crawl.execute` call is limited to
 * (Task 8). Note for that implementer: `crawl.execute`'s `limit` counts
 * `extracted + failed`, not recording-failures — an item whose extraction
 * succeeded but whose outcome write then failed is claimed without counting
 * against the limit. So in that rare outcome-write-failure case, this is not
 * a hard bound on how many items get claimed.
 */
export const PROBE_SAMPLE_LIMIT = 3;
