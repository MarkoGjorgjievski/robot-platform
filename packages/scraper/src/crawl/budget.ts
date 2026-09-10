// Reads sources.budget, which had no reader at all before the crawler.
//
// The defaults conserve REQUESTS TO THE SITE, not dollars: AI cost per detail
// page collapses after the first one (the cache the first page writes serves
// the rest), but every item is still a page load against a domain whose
// anti-bot is this project's binding constraint.

export type Budget = { maxPages: number; maxItems: number; mode: 'all' | 'first_n'; pagesAll: boolean };

/** Applies regardless of configuration: a mis-detected url-pattern template is a loop generator. */
export const HARD_ITEM_CEILING = 5000;

/**
 * "All pages" means the single-burst ceiling the walks already enforce (see
 * `API_WALK_MAX_BATCH` in `plan-run.ts`), not an unbounded walk. Kept as a
 * literal here (rather than imported) because `plan-run.ts` imports this
 * module — importing back would be a cycle. `budget.test.ts` imports both
 * constants and asserts they stay equal.
 */
export const PAGES_ALL_CEILING = 10;

const DEFAULTS: Budget = { maxPages: 3, maxItems: 50, mode: 'first_n', pagesAll: false };

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function resolveBudget(raw: unknown): Budget {
  const b = (raw ?? {}) as Record<string, unknown>;
  const pagesAll = b.max_pages === 'all';
  const itemsAll = b.max_items === 'all' || b.mode === 'all';
  return {
    maxPages: pagesAll ? PAGES_ALL_CEILING : positiveInt(b.max_pages, DEFAULTS.maxPages),
    maxItems: positiveInt(b.max_items, DEFAULTS.maxItems),
    mode: itemsAll ? 'all' : DEFAULTS.mode,
    pagesAll,
  };
}

/** How many detail URLs this run may enumerate in total. */
export function itemCap(budget: Budget): number {
  const requested = budget.mode === 'all' ? HARD_ITEM_CEILING : budget.maxItems;
  return Math.min(requested, HARD_ITEM_CEILING);
}
