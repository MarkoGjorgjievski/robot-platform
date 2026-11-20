// What the "more products from your listing" table shows (Marko 2026-11-20). Pure, so the edge cases — a listing
// with none, one, two or three products, every product already a proof product, pages that could not be read —
// are tested without a server.

/** One product the coverage check read (`sources.coverage`'s `results.sampled`). */
export type SampledProduct = { url: string; empty?: string[]; values?: Record<string, string>; unread?: string };

export type SampledView = {
  /** The products that were read and are not on the proof table: the table's rows. Empty: no table at all. */
  rows: SampledProduct[];
  /** Products the check could not read. Never a row, so the table never shows an error; counted in one quiet line. */
  unread: number;
  /** The heading: "1 more product from your listing", "3 more products from your listing". */
  heading: string;
};

export function sampledView(sampled: readonly SampledProduct[], proofUrls: readonly string[]): SampledView {
  const onBoard = new Set(proofUrls.map(sameProduct));
  const mine = sampled.filter((p) => !onBoard.has(sameProduct(p.url)));
  const rows = mine.filter((p) => p.unread === undefined);
  const n = rows.length;
  return { rows, unread: mine.length - n, heading: `${n} more ${n === 1 ? 'product' : 'products'} from your listing` };
}

/** The same product however the address was written: no query, no fragment, no trailing slash. */
function sameProduct(url: string): string {
  return url.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
}
