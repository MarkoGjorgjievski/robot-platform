import { relativeTime } from '../projects-view';
import { runDotLabel, runDotState, type RunDotStatus } from '../run-dot-view';
import { durationLabel } from '../runs-view';
import { fillBadge, type FieldCoverage } from './coverage-view';
import type { ProbeEvidence } from './probe-evidence';

/**
 * The run page's own copy, kept out of the screen so it can be read and tested
 * without a browser. Everything else the page needs is already a ported module
 * (`run-progress`, `work-list`, `coverage-view`, …).
 */

/**
 * `runs.getWithDetails` takes a `uuid`, so an id that is not one is refused by
 * Zod with a BAD_REQUEST that reads nothing like "no such extraction". A URL
 * someone mistyped is a wrong address, not a failed request — checked here, so
 * the page can say so without spending a round-trip to find out.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRunId(id: string): boolean {
  return UUID.test(id);
}

/** The first block of the uuid — enough to tell two of a website's runs apart. */
export function shortRunId(id: string): string {
  return id.slice(0, 8);
}

/**
 * The dot and the word beside the page's title.
 *
 * The suffix vocabulary is the Runs table's (`runs-view.ts`'s own private
 * `statusLabel`), repeated here rather than exported from there: a run reads as
 * the same thing in the list and on its own page, and these two are the only
 * places that sentence is written. If a third appears, they should be one
 * function.
 */
export function runStatusLine(run: {
  status: string;
  completedAt: Date | null;
  inputLabel: string | null;
}): { state: RunDotStatus; label: string } {
  const state = runDotState(run);
  const label = runDotLabel(state);
  if (run.inputLabel === 'probe') return { state, label: `${label} · sample` };
  if (run.inputLabel === 'backfill') return { state, label: `${label} · repair` };
  return { state, label };
}

export type RunFact = { label: string; value: string };

/**
 * The four facts under the title.
 *
 * Started is `'—'` on a run that never started, rather than the Runs table's
 * fallback to `createdAt`: there the cell is the row's age and its link, here it
 * is a fact with a name, and a "Started" that answers when a run was *queued* is
 * the kind of small lie this app is built not to tell.
 */
export function runFacts(
  run: { startedAt: Date | null; completedAt: Date | null; resultCount: number | null },
  now: Date = new Date(),
): RunFact[] {
  return [
    { label: 'Started', value: run.startedAt ? relativeTime(run.startedAt, now) : '—' },
    { label: 'Completed', value: run.completedAt ? relativeTime(run.completedAt, now) : '—' },
    { label: 'Duration', value: durationLabel(run.startedAt, run.completedAt) ?? '—' },
    { label: 'Rows', value: run.resultCount == null ? '—' : run.resultCount.toLocaleString('en-US') },
  ];
}

/**
 * What a repair run was sent to fix, for the line that names its parent. `null`
 * when it targeted nothing in particular — an ordinary run, or a repair whose
 * target fields were never recorded.
 */
export function repairNote(targetFields: string[] | null | undefined): string | null {
  if (!targetFields || targetFields.length === 0) return null;
  return `repairing ${targetFields.join(', ')}`;
}

/** The lead-in to the links at the other end of a repair: this run's own children. */
export function reExtractedLabel(count: number): string {
  return `Re-extracted in ${count} ${count === 1 ? 'run' : 'runs'}`;
}

/** The line above the results sheet: how much came back, and how sure the engine was. */
export function resultsSummary(rowCount: number, confidence: number | null | undefined): string {
  const rows = rowCount === 0 ? 'No rows' : `${rowCount.toLocaleString('en-US')} ${rowCount === 1 ? 'row' : 'rows'}`;
  return confidence == null ? rows : `${rows} · ${confidence}% confidence`;
}

/**
 * Said once above the sheet, not in a caption under row 500 nobody scrolls to —
 * the same bargain `output-view.ts` strikes. `null` when everything is on screen.
 */
export function resultsNote(shown: number, total: number): string | null {
  if (shown >= total) return null;
  return `Showing the first ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} — the download has all of them.`;
}

/** The same, for the work list, which has no download behind it. */
export function workListNote(shown: number, total: number): string | null {
  if (shown >= total) return null;
  return `Showing the first ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} pages.`;
}

/**
 * The sample gate's four facts, in the same `RunFact` grammar the run's own
 * facts use — `probeEvidence` answers what a probe run walked and found, and
 * this is that answer said in the customer's words.
 *
 * "Products", not "items": the word for a detail page in this app is a product
 * (spec §6), and `itemsFound` is the engine's own name for the same number.
 */
export function probeFacts(evidence: ProbeEvidence): RunFact[] {
  return [
    { label: 'Pages walked', value: evidence.pagesWalked.toLocaleString('en-US') },
    { label: 'Products found', value: evidence.itemsFound.toLocaleString('en-US') },
    { label: 'Pagination', value: evidence.paginationNote },
    { label: 'Warnings', value: evidence.warningsCount.toLocaleString('en-US') },
  ];
}

/**
 * One option in the repair bar's field picker: the customer's name for the
 * field, and how much of its column came back.
 *
 * The fill count is `fillBadge`'s, so a field with nothing missing carries no
 * number at all — but such a field is never offered here in the first place,
 * which is exactly why the badge is allowed to be absent rather than "40/40".
 */
export function gapFieldOption(cov: FieldCoverage | undefined, displayName: string): string {
  const badge = fillBadge(cov);
  return badge ? `${displayName} · ${badge} filled` : displayName;
}

/** What a picked field leaves empty, stated before anything is selected. */
export function missingRowsLine(count: number, displayName: string): string {
  const noun = count === 1 ? 'row' : 'rows';
  return `${count.toLocaleString('en-US')} ${noun} missing ${displayName}`;
}

/**
 * The tick that arms the one spender in the repair bar. It names the count
 * because it IS the choice — there are no per-row ticks, so this box is the
 * whole selection, and a bare "Select all" would leave the number of pages
 * about to be fetched to be read off a different line.
 */
export function selectAllLabel(count: number): string {
  const noun = count === 1 ? 'row' : 'rows';
  return `Select all ${count.toLocaleString('en-US')} ${noun}`;
}

/** A field's fill, as the repair checklist prints it. */
export function fillLabel(fill: number): string {
  return `${Math.round(fill * 100)}% filled`;
}

/**
 * `runs.variantSummary` (`@robot/scraper`'s `VariantRunSummary`, read back as
 * plain JSON over tRPC — declared locally rather than imported, same reason
 * `variants-view.ts` declares its own detection types: the app never imports
 * `@robot/scraper` into a browser bundle).
 */
export type VariantSummary = {
  variants: number;
  products: number;
  withoutVariants: number;
  partial: number;
  variantsSkippedForBudget: number;
};

/**
 * The run page's variant counts (spec 2026-10-02-variants-plan3 §5.3), shown
 * only on a variants run — an empty array for every other run, so the caller
 * can render it with no extra `if`. Exact wording, in this order; the skipped
 * line only when it is above zero.
 */
export function variantCountLines(summary: VariantSummary | null | undefined): string[] {
  // Final review I2: mid-run the stored summary can be only the skip tally
  // (`skippedByProduct`/`variantsSkippedForBudget`, queue-variant-pages.ts) —
  // not a summary to show yet, and never a reason to throw.
  if (!summary || typeof summary.variants !== 'number') return [];
  const lines = [
    `${summary.variants.toLocaleString('en-US')} variants from ${summary.products.toLocaleString('en-US')} products`,
    `${summary.withoutVariants.toLocaleString('en-US')} products without variants`,
    `${summary.partial.toLocaleString('en-US')} products with partial variants`,
  ];
  if (summary.variantsSkippedForBudget > 0) {
    lines.push(`${summary.variantsSkippedForBudget.toLocaleString('en-US')} variant pages skipped for the budget`);
  }
  return lines;
}

/**
 * `FieldClassification`'s verdict in words. "dead" is the engine's own name for
 * a cached path that has stopped answering; what the customer needs to read is
 * what that means for the field in front of them.
 */
export function classificationLabel(classification: 'healthy' | 'dead'): string {
  return classification === 'dead' ? 'path looks broken' : 'path looks fine';
}
