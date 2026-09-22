import { relativeTime } from '../projects-view';
import { runDotLabel, runDotState, type RunDotStatus } from '../run-dot-view';
import { durationLabel } from '../runs-view';

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
