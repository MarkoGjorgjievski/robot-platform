// Copy for the run page's grouped misses (spec 2026-09-17 §5).
export type MissGroupView = { listingUrl: string | null; count: number; urls: string[] };
export type FieldMissesView = { name: string; count: number; total: number; groups: MissGroupView[] };

export function listingLabel(url: string | null): string {
  if (url === null) return 'the product URLs you gave';
  try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
}

export function missLine(f: FieldMissesView, label: string): string {
  const head = `${label} is empty on ${f.count.toLocaleString('en-US')} of ${f.total.toLocaleString('en-US')} products`;
  if (f.groups.length === 1) return `${head} · all from ${listingLabel(f.groups[0]!.listingUrl)}`;
  return [head, ...f.groups.map((g) => `${g.count.toLocaleString('en-US')} from ${listingLabel(g.listingUrl)}`)].join(' · ');
}
