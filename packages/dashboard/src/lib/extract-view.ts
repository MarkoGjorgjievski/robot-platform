// Pure view logic for the Extract tab's three-step stepper (Pages, Sample, Run).
// No React, no tRPC, no DOM — see docs/extraction-architecture.md and
// .superpowers/sdd/2026-09-10-mvp-flow-phase4-extract-tab/task-4-brief.md.
import type { ProbeEvidence } from './probe-evidence';

export type StepState = 'locked' | 'current' | 'done' | 'later';
export type ExtractMode = 'listing' | 'detail';

/** A sample run as the stepper reads it: how it ended, and how many rows it produced. */
export type SampleRun = { status: string; rows: number };

/**
 * Has the sample finished producing its evidence?
 *
 * Not just `completed`. A probe that extracted some rows and gave up on the
 * rest finalises `partial` — the ordinary outcome of a three-product sample
 * where one page 404s or a certified path misses — and that run is terminal:
 * it will never become `completed`, no matter how long the tab waits. Its
 * evidence is the same evidence, so it must not leave Run out of reach
 * forever. A `partial` that produced NO rows proved nothing and does not
 * count.
 */
export function sampleFinished(sampleRun: SampleRun | null): boolean {
  if (!sampleRun) return false;
  return sampleRun.status === 'completed' || (sampleRun.status === 'partial' && sampleRun.rows > 0);
}

/** Which of the three stepper steps (Pages, Sample, Run) is current/done/later, or all locked. */
export function stepStates(args: {
  schemaGreen: boolean;
  mode: ExtractMode | null;
  pagesSaved: boolean;
  sampleRun: SampleRun | null;
  running: boolean;
}): [StepState, StepState, StepState] {
  const { schemaGreen, mode, pagesSaved, sampleRun, running } = args;
  if (!schemaGreen) return ['locked', 'locked', 'locked'];
  if (running) return ['done', 'done', 'done'];
  if (!mode || !pagesSaved) return ['current', 'later', 'later'];
  if (mode === 'detail') return ['done', 'done', 'current'];
  // mode === 'listing'
  if (sampleFinished(sampleRun)) return ['done', 'done', 'current'];
  return ['done', 'current', 'later'];
}

/**
 * The listing check chip: pending while running, error text verbatim, a
 * product-link/pager summary, or `saved` for a page that came back from the
 * database and has not been checked in this session. `saved` is deliberately
 * NOT a check result — the page is only ever checked when someone asks, so
 * opening the tab never launches a browser.
 */
export function listingCheckLabel(
  check: { productLinks: number; pagerSeen: boolean } | { error: string } | { saved: true } | null,
): { tone: 'ok' | 'warn' | 'error' | 'pending'; text: string } {
  if (check === null) return { tone: 'pending', text: 'checking…' };
  if ('saved' in check) return { tone: 'pending', text: 'saved' };
  if ('error' in check) return { tone: 'error', text: check.error };
  const linkWord = check.productLinks === 1 ? 'link' : 'links';
  const base = `${check.productLinks} product ${linkWord}`;
  return check.pagerSeen
    ? { tone: 'ok', text: `${base} · pager found` }
    : { tone: 'warn', text: `${base} · no pager seen` };
}

function parseUrl(line: string): URL | null {
  try {
    const u = new URL(line.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

function stripHash(href: string): string {
  return href.split('#')[0]!;
}

/** Counts across pasted product-URL lines: how many parse as http(s), how many match a proof URL (hash-insensitive), and how many are off the given host. */
export function productUrlCounts(
  lines: string[],
  proofUrls: string[],
  host: string | null,
): { total: number; proof: number; offHost: number } {
  const proofSet = new Set(proofUrls.map(stripHash));
  let total = 0;
  let proof = 0;
  let offHost = 0;
  for (const line of lines) {
    const url = parseUrl(line);
    if (!url) continue;
    total++;
    if (proofSet.has(stripHash(url.href))) proof++;
    if (host !== null && url.hostname.toLowerCase() !== host.toLowerCase()) offHost++;
  }
  return { total, proof, offHost };
}

/**
 * What this budget means, said out loud.
 *
 * Listing mode: "3 listings · first 5 products from each · up to 10 pages per
 * listing · safety stop at 5,000 products per run" (or the numeric-pages
 * variant). `count` is how many listing pages will be walked.
 *
 * Detail mode: "12 product URLs · safety stop at 5,000 products per run", and
 * `count` is how many URLs were pasted. There is no pagination clause at all —
 * a fixed list of product pages has nothing to page through, and the old
 * wording called those URLs "listings", which they are not.
 */
export function runSentence(
  b: { items: number | 'all'; pages: number | 'all' },
  count: number,
  mode: ExtractMode = 'listing',
): string {
  const parts: string[] = [];
  const detail = mode === 'detail';
  parts.push(
    detail
      ? `${count} ${count === 1 ? 'product URL' : 'product URLs'}`
      : `${count} ${count === 1 ? 'listing' : 'listings'}`,
  );
  if (b.items !== 'all') {
    parts.push(
      detail
        ? `first ${b.items} ${b.items === 1 ? 'product' : 'products'}`
        : `first ${b.items} ${b.items === 1 ? 'product' : 'products'} from each`,
    );
  }
  if (!detail) {
    parts.push(
      b.pages === 'all'
        ? 'up to 10 pages per listing'
        : `first ${b.pages} ${b.pages === 1 ? 'page' : 'pages'} of each`,
    );
  }
  parts.push(`safety stop at ${(5000).toLocaleString('en-US')} products per run`);
  return parts.join(' · ');
}

/** Form values -> the budget shape persisted server-side. */
export function budgetFromForm(
  items: number | 'all',
  pages: number | 'all',
): { max_items: number | 'all'; max_pages: number | 'all'; mode: 'all' | 'first_n' } {
  return { max_items: items, max_pages: pages, mode: items === 'all' ? 'all' : 'first_n' };
}

function positiveInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * The starter budget the pre-Extract-tab flow wrote by itself — `LISTING_
 * DEFAULT_BUDGET` in packages/api/src/routers/sources.ts, `{ max_items: 40,
 * max_pages: 3, mode: 'first_n' }`. No customer chose those numbers, so the
 * Run section must not open on `custom 40 / custom 3` and claim they did.
 * Exactly this object, no more keys and no fewer.
 */
function isAutomaticStarterBudget(r: Record<string, unknown>): boolean {
  return (
    Object.keys(r).length === 3 && r.max_items === 40 && r.max_pages === 3 && r.mode === 'first_n'
  );
}

/**
 * Persisted budget (possibly missing, legacy, or malformed) -> form values.
 * Unknown/invalid always falls back to 'all'.
 *
 * `legacy` says the Extract tab has never owned this website's input
 * (`parameters.inputMode` is unset) — the only state in which a budget can
 * have been written by the old flow rather than chosen. It matters because
 * `budgetFromForm(40, 3)` produces an object byte-identical to the automatic
 * starter, so value-matching alone would reset a customer who deliberately
 * picked 40 products across 3 pages. Outside legacy, 40/3 is a real choice
 * and passes straight through. The server applies the same rule from the same
 * signal (`budgetIsUnchosen` in sources.ts).
 */
export function budgetToForm(
  raw: unknown,
  opts: { legacy: boolean } = { legacy: false },
): { items: number | 'all'; pages: number | 'all' } {
  if (typeof raw !== 'object' || raw === null) return { items: 'all', pages: 'all' };
  if (opts.legacy && isAutomaticStarterBudget(raw as Record<string, unknown>)) {
    return { items: 'all', pages: 'all' };
  }
  const r = raw as { max_items?: unknown; max_pages?: unknown; mode?: unknown };
  const pages = positiveInt(r.max_pages) ?? 'all';
  if (r.mode === 'all') return { items: 'all', pages };
  const items = positiveInt(r.max_items) ?? 'all';
  return { items, pages };
}

/** "Extraction is locked · 4 of 5 fields verified · fix author_url on the Schema tab" (fix clause only when there's a first failing field). */
export function lockedStripText(args: { fieldCount: number; currentKeys: string[]; firstFailing: string | null }): string {
  const { fieldCount, currentKeys, firstFailing } = args;
  const fieldWord = fieldCount === 1 ? 'field' : 'fields';
  let text = `Extraction is locked · ${currentKeys.length} of ${fieldCount} ${fieldWord} verified`;
  if (firstFailing !== null) text += ` · fix ${firstFailing} on the Schema tab`;
  return text;
}

/**
 * The confirm gate's four evidence facts, in fixed order.
 *
 * `rows` is about the SAMPLE, not the walk: `total` is how many rows the
 * sample actually produced and `complete` how many of those have every
 * contract column filled. It used to compare the extracted rows against every
 * product link the listing walk found ("3 of 28"), which read as a 90%
 * failure when the sample had done exactly what it promised — sample three
 * products, all three complete.
 */
export function sampleFacts(
  evidence: ProbeEvidence,
  rows: { complete: number; total: number },
): Array<{ label: string; value: string }> {
  return [
    { label: 'Pages walked', value: String(evidence.pagesWalked) },
    { label: 'Product links found', value: String(evidence.itemsFound) },
    { label: 'Pagination detected', value: evidence.paginationNote },
    { label: 'Sample rows complete', value: `${rows.complete} of ${rows.total}` },
  ];
}

/** The note shown under a field whose sample cells came back empty on some pages: "price was empty on 2 of 3 sampled pages. ..." */
export function emptyCellNote(field: string, emptyOn: number, sampled: number): string {
  const pageWord = sampled === 1 ? 'page' : 'pages';
  return `${field} was empty on ${emptyOn} of ${sampled} sampled ${pageWord}. Extraction leaves such cells empty and counts them; it never guesses.`;
}

