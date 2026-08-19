// Reads sources.budget, which had no reader at all before the crawler.
//
// The defaults conserve REQUESTS TO THE SITE, not dollars: AI cost per detail
// page collapses after the first one (the cache the first page writes serves
// the rest), but every item is still a page load against a domain whose
// anti-bot is this project's binding constraint.

export type Budget = { maxPages: number; maxItems: number; mode: 'all' | 'first_n' };

/** Applies regardless of configuration: a mis-detected url-pattern template is a loop generator. */
export const HARD_ITEM_CEILING = 5000;

const DEFAULTS: Budget = { maxPages: 3, maxItems: 50, mode: 'first_n' };

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function resolveBudget(raw: unknown): Budget {
  const b = (raw ?? {}) as Record<string, unknown>;
  return {
    maxPages: positiveInt(b.max_pages, DEFAULTS.maxPages),
    maxItems: positiveInt(b.max_items, DEFAULTS.maxItems),
    mode: b.mode === 'all' ? 'all' : DEFAULTS.mode,
  };
}

/** How many detail URLs this run may enumerate in total. */
export function itemCap(budget: Budget): number {
  const requested = budget.mode === 'all' ? HARD_ITEM_CEILING : budget.maxItems;
  return Math.min(requested, HARD_ITEM_CEILING);
}
