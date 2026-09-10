// Pure view logic for the Extract tab's three-step stepper (Pages, Sample, Run).
// No React, no tRPC, no DOM — see docs/extraction-architecture.md and
// .superpowers/sdd/2026-09-10-mvp-flow-phase4-extract-tab/task-4-brief.md.
import type { ProbeEvidence } from './probe-evidence';

export type StepState = 'locked' | 'current' | 'done' | 'later';
export type ExtractMode = 'listing' | 'detail';

/** Which of the three stepper steps (Pages, Sample, Run) is current/done/later, or all locked. */
export function stepStates(args: {
  schemaGreen: boolean;
  mode: ExtractMode | null;
  pagesSaved: boolean;
  sampleRun: { status: string } | null;
  running: boolean;
}): [StepState, StepState, StepState] {
  const { schemaGreen, mode, pagesSaved, sampleRun, running } = args;
  if (!schemaGreen) return ['locked', 'locked', 'locked'];
  if (running) return ['done', 'done', 'done'];
  if (!mode || !pagesSaved) return ['current', 'later', 'later'];
  if (mode === 'detail') return ['done', 'done', 'current'];
  // mode === 'listing'
  if (sampleRun && sampleRun.status === 'completed') return ['done', 'done', 'current'];
  return ['done', 'current', 'later'];
}

/** The listing check chip: pending while running, error text verbatim, or a product-link/pager summary. */
export function listingCheckLabel(
  check: { productLinks: number; pagerSeen: boolean } | { error: string } | null,
): { tone: 'ok' | 'warn' | 'error' | 'pending'; text: string } {
  if (check === null) return { tone: 'pending', text: 'checking…' };
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

/** "3 listings · first 5 products from each · up to 10 pages per listing · safety stop at 5,000 products per run" (or the numeric-pages variant). */
export function runSentence(b: { items: number | 'all'; pages: number | 'all' }, listings: number): string {
  const parts: string[] = [];
  parts.push(`${listings} ${listings === 1 ? 'listing' : 'listings'}`);
  if (b.items !== 'all') {
    parts.push(`first ${b.items} ${b.items === 1 ? 'product' : 'products'} from each`);
  }
  if (b.pages === 'all') {
    parts.push('up to 10 pages per listing');
  } else {
    parts.push(`first ${b.pages} ${b.pages === 1 ? 'page' : 'pages'} of each`);
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

/** Persisted budget (possibly missing, legacy, or malformed) -> form values. Unknown/invalid always falls back to 'all'. */
export function budgetToForm(raw: unknown): { items: number | 'all'; pages: number | 'all' } {
  if (typeof raw !== 'object' || raw === null) return { items: 'all', pages: 'all' };
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

/** The confirm gate's four evidence facts, in fixed order. */
export function sampleFacts(
  evidence: ProbeEvidence,
  counts: { detail: number; done: number },
): Array<{ label: string; value: string }> {
  return [
    { label: 'Pages walked', value: String(evidence.pagesWalked) },
    { label: 'Product links found', value: String(evidence.itemsFound) },
    { label: 'Pagination detected', value: evidence.paginationNote },
    { label: 'Sample rows complete', value: `${counts.done} of ${counts.detail}` },
  ];
}

/** The note shown under a field whose sample cells came back empty on some pages: "price was empty on 2 of 3 sampled pages. ..." */
export function emptyCellNote(field: string, emptyOn: number, sampled: number): string {
  const pageWord = sampled === 1 ? 'page' : 'pages';
  return `${field} was empty on ${emptyOn} of ${sampled} sampled ${pageWord}. Extraction leaves such cells empty and counts them; it never guesses.`;
}

