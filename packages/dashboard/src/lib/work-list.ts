import { formatValue } from './format';

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
