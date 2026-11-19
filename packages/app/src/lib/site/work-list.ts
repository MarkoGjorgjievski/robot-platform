/**
 * The dashboard's `lib/format.ts` `formatValue`, verbatim, as a module-private
 * helper — the one import this file had when it was ported.
 *
 * It is not `cellText` (lib/output-view.ts): that one renders an array by
 * joining its elements, which is right for a results cell and wrong here, where
 * `scroll_rounds: [{"rows":180,"planned":36}]` has to read back as the JSON the
 * engine actually carried down. The rest of `format.ts` — `previewValue`,
 * `formatDate` — has no reader in this app and duplicates `relativeTime`, so
 * copying the whole module would have brought two dead exports with it.
 */
function formatValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Counts as `crawl.items` reports them.
 *
 * `running` is optional here only because this summary predates it: the field
 * is always present on the wire, and it is listed so the type keeps describing
 * the whole payload rather than quietly drifting from it again.
 */
export type WorkListCounts = {
  listing: number;
  detail: number;
  pending: number;
  running?: number;
  done: number;
  failed: number;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One line describing a planned crawl.
 *
 * Leads with the detail URLs, because that number is the decision: it is what
 * phase 2 will fetch, and what the budget was there to contain. Listing pages
 * walked is the supporting detail, and failures are called out because they are
 * the reason to look at a work list at all.
 */
export function summariseWorkList(counts: WorkListCounts): string {
  const parts = [
    counts.detail === 0 ? 'No URLs found' : `${plural(counts.detail, 'URL', 'URLs')} to extract`,
    `${plural(counts.listing, 'listing page', 'listing pages')} walked`,
  ];
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  return parts.join(' · ');
}

/**
 * The listing-page values carried down to a detail item, as one short line.
 *
 * These are the fields that exist ONLY on the listing — a category shown once in
 * a header, a price shown in the grid — so seeing them attached to each queued
 * URL is how you confirm the carry-down worked before phase 2 runs.
 */
export function listingValuesLabel(values: unknown): string {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return '—';
  const entries = Object.entries(values as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}: ${formatValue(v)}`).join(' · ');
}

export type WorkListRow = { id: string; kind: string; url: string; status: string; pageNumber: number | null; inputIndex?: number | null };
export type WorkListGroup<T extends WorkListRow> = {
  /** The listing page these products were found on; null for products given as their own addresses. */
  listing: T | null;
  products: T[];
  /** "Listing 2 · page 3"; "Products" with no listing. The listing number only when the run has several. */
  title: string;
  /** "24 products · 16 extracted · 2 failed" — only the parts that are not zero. */
  summary: string;
};

/**
 * The work list as the customer thinks of it (Marko 2026-11-17): each listing page, and under it the products
 * found on it. A product row carries the listing it came from (`inputIndex`) and that listing's page number.
 * Listing order, then page order; a product with no listing row of its own (product addresses, a repair) goes
 * under one "Products" group at the end of its listing's pages.
 */
export function groupWorkList<T extends WorkListRow>(items: readonly T[]): WorkListGroup<T>[] {
  const key = (i: T) => `${i.inputIndex ?? 0}\u0000${i.pageNumber ?? 0}`;
  const listings = items.filter((i) => i.kind === 'listing');
  const walked = new Set(listings.map((i) => i.inputIndex ?? 0));
  const several = walked.size > 1;
  const groups = new Map<string, { listing: T | null; products: T[] }>();
  for (const l of listings) if (!groups.has(key(l))) groups.set(key(l), { listing: l, products: [] });
  for (const i of items) {
    if (i.kind === 'listing') continue;
    // No listing row at all for this input (product addresses, a repair): one group for all such products.
    const k = groups.has(key(i)) ? key(i) : walked.has(i.inputIndex ?? 0) ? `${i.inputIndex ?? 0}\u0000none` : 'none';
    if (!groups.has(k)) groups.set(k, { listing: null, products: [] });
    groups.get(k)!.products.push(i);
  }
  const order = (g: { listing: T | null; products: T[] }) => {
    const any = g.listing ?? g.products[0]!;
    return [g.listing || walked.has(any.inputIndex ?? 0) ? (any.inputIndex ?? 0) : Number.MAX_SAFE_INTEGER, g.listing ? (g.listing.pageNumber ?? 0) : Number.MAX_SAFE_INTEGER] as const;
  };
  return [...groups.values()]
    .sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1])
    .map((g) => {
      const n = (status: string) => g.products.filter((p) => p.status === status).length;
      const parts = [plural(g.products.length, 'product', 'products')];
      if (n('done') > 0) parts.push(`${n('done')} extracted`);
      if (n('failed') > 0) parts.push(`${n('failed')} failed`);
      const title = g.listing
        ? `${several ? `Listing ${(g.listing.inputIndex ?? 0) + 1} · ` : 'Listing · '}page ${g.listing.pageNumber ?? 1}`
        : 'Products';
      return { ...g, title, summary: parts.join(' · ') };
    });
}

/** A page's status in the customer's words: "pending" read as a fault on a stopped run; it only means not tried yet. */
export function pageStatusWord(status: string): string {
  return ({ pending: 'not extracted yet', running: 'extracting', done: 'extracted', failed: 'failed' } as Record<string, string>)[status] ?? status;
}
