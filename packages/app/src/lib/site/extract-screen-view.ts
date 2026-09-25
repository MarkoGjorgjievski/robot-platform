/**
 * What the Extract tab decides, without React.
 *
 * `extract-view.ts` (ported in task 3) already owns the stepper's arithmetic and
 * every sentence the spec pins word for word. This module is the rest of the
 * screen's thinking — the parts that used to sit inline in the old dashboard
 * route (`packages/dashboard/src/routes/source-extract.tsx`) and could only be
 * checked by clicking: which reason a blocked button gives, what the three strip
 * cells say, which column of a CSV holds the URLs, what a save actually did.
 *
 * Nothing here touches tRPC or the DOM, so all of it is tested in
 * `extract-screen-view.test.ts`.
 */
import { isRunActive, progressLabel, type RunCounts } from './run-progress';
import { runDotState, type RunDotStatus } from '../run-dot-view';
import { parseUrlLines } from './parse-url-lines';
import type { ExtractMode, StepState } from './extract-view';

/** The server's own Zod bounds on the two setters, so the client can say them in words first. */
export const MAX_LISTING_PAGES = 50;
export const MAX_PRODUCT_URLS = 5000;

/**
 * The warning half of `formatPlanLog` (packages/api/src/crawl/plan-source.ts),
 * read back off a persisted run:
 *
 *   const lines = [
 *     ...warnings.map((w) => `warning: ${w}`),
 *     ...errors.map((e) => `error: input ${e.inputIndex}: ${e.message}`),
 *   ];
 *
 * `runs.logs` is the only place a finished run's plan warnings survive — the
 * mutation response carrying them is gone the moment the tab reloads — and
 * `probeEvidence` names the pagination strategy by matching the ORIGINAL
 * strings, not the prefixed log lines. Only the warnings are recovered here:
 * the sample section has no use for the plan's per-input errors, and a half-read
 * log is worse than an unread one.
 */
export function parseRunWarnings(logs: string | null | undefined): string[] {
  return (logs ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('warning: '))
    .map((line) => line.slice('warning: '.length));
}

/** The hostname of the first usable URL, which is what an off-host count is measured against. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * `editing` reopens exactly one section: it becomes `current` and everything
 * after it goes back to `later`, because a step's evidence is only as good as
 * the step before it. Earlier sections keep whatever `stepStates` said.
 */
export function withEditing(
  states: [StepState, StepState, StepState],
  editing: number | null,
): [StepState, StepState, StepState] {
  if (editing === null) return states;
  return states.map((state, i) =>
    i + 1 === editing ? 'current' : i + 1 > editing ? 'later' : state,
  ) as [StepState, StepState, StepState];
}

/**
 * A probe run that has not settled yet, so the runs list is worth polling. The
 * lifecycle is `planning -> planned -> extracting -> completed | partial |
 * failed`, plus `cancelling`/`cancelled`; `isRunActive` covers the last two
 * moving states and `planning`/`planned` are the ones before the loop starts.
 */
export function isProbeMoving(status: string): boolean {
  return status === 'planning' || status === 'planned' || isRunActive(status);
}

/**
 * Which shape the *stored* pages are in — `null` when nothing is stored.
 *
 * `parameters.inputMode` is this tab's own marker, written the first time it
 * saves. On its own it is not enough: a website set up before this tab existed
 * — which is every website on this machine today — has no marker at all, and
 * reading the marker alone said "nothing is saved" about a website whose
 * listing page was sitting right above the sentence, labelled *saved*
 * (found on Acne / Ikea by the look-only check, 2026-09-23).
 *
 * What the old flow did write is the `listingMode` column, and the rows are in
 * `inputRows`; together they say the same thing the marker would have. This is
 * the same fallback the tab already used to seed the segmented control, so the
 * control and the gates below it now agree by construction instead of by
 * coincidence.
 */
export function storedMode(args: {
  inputMode: ExtractMode | null | undefined;
  listingMode: 'listing_to_detail' | 'detail' | null;
  savedCount: number;
}): ExtractMode | null {
  const { inputMode, listingMode, savedCount } = args;
  if (inputMode) return inputMode;
  if (listingMode === 'listing_to_detail') return 'listing';
  // A `detail` website with no rows has chosen a shape but stored nothing, and
  // there is no listing page standing in for the choice either.
  if (listingMode === 'detail' && savedCount > 0) return 'detail';
  return null;
}

/**
 * Is a stored budget old enough that exactly 40 products / 3 pages can only be
 * the pre-Extract-tab flow's automatic starter, rather than a choice?
 *
 * This is the `legacy` argument of `budgetToForm`, and it exists because
 * `budgetFromForm(40, 3)` produces an object byte-identical to that starter.
 * Two markers on the website's `parameters` say a human is behind the numbers,
 * and it takes both being absent to call a budget legacy:
 *
 * - `inputMode` — the Extract tab has saved this website's pages at least once,
 *   so every budget it holds came through this screen.
 * - `budgetChosen` — a budget was written through `sources.update`. The
 *   Settings tab's budget row is that writer, and it never touches the input
 *   set, so it sets no `inputMode`. Without reading this marker the Extract tab
 *   went on showing all/all for a 40/3 saved on Settings and then wrote all/all
 *   over it on the next Extract — the run collecting everything instead of the
 *   40 that were asked for.
 *
 * The server decides the same question from the same two markers
 * (`budgetIsUnchosen` in packages/api/src/routers/sources.ts).
 */
export function budgetIsLegacy(args: { inputMode: ExtractMode | null | undefined; budgetChosen: unknown }): boolean {
  return !args.inputMode && args.budgetChosen !== true;
}

/**
 * Are the pages on screen the pages that are actually stored?
 *
 * Saved, not merely typed: `savedMode` is what `storedMode` answers, so a
 * website with nothing stored starts at step 1 with an empty box rather than
 * claiming pages it never confirmed.
 *
 * `savedMode === mode` is the second half, and it stops a real misfire:
 * flipping the segmented control to the other shape without saving left this
 * true, so Run stayed unlocked and Extract planned against the input still
 * stored for the mode just navigated away from.
 *
 * `editing === null` is the third, and it is the same misfire through the other
 * door. "Edit pages" reopens section 1 with the stored pages in the box; paste
 * different ones and, without this, every gate below still read "saved" — so
 * Extract stayed live and would have spent a real crawl on the input set the
 * screen was no longer showing. A reopened section has nothing saved *for what
 * is on screen* until Save is pressed again, which is exactly what the two
 * gates then say. (Section 1 is the only one that reopens, so any non-null
 * `editing` means these pages are in flight.)
 */
export function pagesAreSaved(args: {
  savedCount: number;
  savedMode: ExtractMode | null;
  mode: ExtractMode | null;
  editing: number | null;
}): boolean {
  const { savedCount, savedMode, mode, editing } = args;
  return savedCount > 0 && savedMode !== null && savedMode === mode && editing === null;
}

/**
 * Why Extract cannot be pressed, in the order a customer meets the reasons.
 * `null` means it can. Every one of these is rendered beside the button — a
 * disabled control with no visible reason is the thing spec §6 forbids.
 */
export function extractGate(args: {
  green: boolean;
  pagesSaved: boolean;
  mode: ExtractMode | null;
  sampleDone: boolean;
}): string | null {
  const { green, pagesSaved, mode, sampleDone } = args;
  if (!green) return 'Verify every field on the Verification tab first';
  if (!mode) return 'Choose where the products come from';
  if (!pagesSaved) return mode === 'detail' ? 'Save your URLs first' : 'Save your pages first';
  if (mode === 'listing' && !sampleDone) return 'Sample first';
  return null;
}

/** The same question for the Sample button: it needs a saved set of listing pages and nothing else. */
export function sampleGate(args: { green: boolean; pagesSaved: boolean }): string | null {
  if (!args.green) return 'Verify every field on the Verification tab first';
  if (!args.pagesSaved) return 'Save your pages first';
  return null;
}

/** One strip cell: the second line says what the step knows, or why it is out of reach. */
export type StripCell = { n: number; title: string; detail: string; reason?: string; state: StepState };

/**
 * The three cells above the sections. The detail line is what that step already
 * knows — the count it holds, the rows it produced — rather than a restatement
 * of its own title; an unreachable cell swaps that for the reason instead.
 */
export function stripCells(args: {
  states: [StepState, StepState, StepState];
  mode: ExtractMode | null;
  pageCount: number;
  sampleRows: number | null;
  runLabel: string | null;
}): [StripCell, StripCell, StripCell] {
  const { states, mode, pageCount, sampleRows, runLabel } = args;

  const pages =
    mode === null
      ? 'not chosen yet'
      : mode === 'detail'
        ? `${pageCount} product URL${pageCount === 1 ? '' : 's'}`
        : `${pageCount} listing page${pageCount === 1 ? '' : 's'}`;

  const sample =
    mode === 'detail'
      ? 'not needed, the pages are known'
      : sampleRows === null
        ? 'not run yet'
        : `${sampleRows} row${sampleRows === 1 ? '' : 's'} extracted`;

  return [
    { n: 1, title: 'Pages', detail: pages, state: states[0] },
    // The reasons follow `extractGate`'s own order, so a cell out of reach and
    // the button it leads to never name two different next steps — and before
    // a shape is chosen, "Sample first" would be presuming one.
    {
      n: 2,
      title: 'Sample',
      detail: sample,
      reason: mode === null ? 'Choose where the products come from' : 'Save your pages first',
      state: states[1],
    },
    {
      n: 3,
      title: 'Run',
      detail: runLabel ?? 'not started',
      reason:
        mode === null
          ? 'Choose where the products come from'
          : mode === 'detail'
            ? 'Save your URLs first'
            : 'Sample first',
      state: states[2],
    },
  ];
}

/**
 * The progress line a started run shows in place of the Extract button.
 *
 * "Extracting · 12 of 40" while the loop is working, and the run page's own
 * wording (`progressLabel`) once it is planned-but-idle or finished, so the two
 * screens never describe the same run differently. The dot is `runDotState`'s
 * ordinary mapping — which answers `running` for `planning`/`planned` too, and
 * is why a finished run stops pulsing beside "40 of 40 extracted".
 */
export function runProgressLine(
  data: { status: string; counts: RunCounts } | null | undefined,
): { label: string; dot: RunDotStatus } {
  // The window between `crawl.execute` returning and the first `crawl.status`
  // landing. Something is certainly moving; the dot says so.
  if (!data) return { label: 'Starting…', dot: 'running' };
  const label = isRunActive(data.status)
    ? `Extracting · ${data.counts.done} of ${data.counts.detail}`
    : progressLabel(data.counts, data.status);
  return { label, dot: runDotState({ status: data.status }) };
}

/**
 * What a product-URL save actually did, in sentences rather than a middle-dot
 * chain (spec §6 — this is prose, not a strip). `skipped` came back from the
 * server (URLs off this website); `invalid` never left the browser, because
 * `setProductUrls` validates every entry with `httpUrl` and one `ftp:` line
 * would fail the whole save with a Zod issue naming an array index.
 */
export function saveNote(args: { skipped: number; invalid: number }): string | null {
  const parts: string[] = [];
  if (args.skipped > 0) {
    parts.push(
      args.skipped === 1
        ? '1 URL is off this website, so it was skipped.'
        : `${args.skipped} URLs are off this website, so they were skipped.`,
    );
  }
  if (args.invalid > 0) {
    parts.push(
      args.invalid === 1
        ? '1 line was not a URL and was left out.'
        : `${args.invalid} lines were not URLs and were left out.`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** The inline count under the product-URL box: total, proof pages, off-host. Sentences, same reason. */
export function productCountsSentence(counts: { total: number; proof: number; offHost: number }): string {
  return [
    `${counts.total} ${counts.total === 1 ? 'URL' : 'URLs'}.`,
    counts.proof > 0
      ? counts.proof === 1
        ? '1 is a proof page.'
        : `${counts.proof} are the proof pages.`
      : null,
    counts.offHost > 0
      ? counts.offHost === 1
        ? '1 is off this website and will be skipped.'
        : `${counts.offHost} are off this website and will be skipped.`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}

/**
 * The server's `.max()` on the two setters, said in words before it is hit.
 * Without this the whole save comes back as a raw Zod issue payload naming an
 * array index, which is not something a customer can act on.
 */
export function tooManyMessage(mode: ExtractMode, count: number): string | null {
  const limit = mode === 'detail' ? MAX_PRODUCT_URLS : MAX_LISTING_PAGES;
  if (count <= limit) return null;
  const what = mode === 'detail' ? 'URLs' : 'listing pages';
  return `That is ${count.toLocaleString('en-US')} ${what}; ${limit.toLocaleString('en-US')} is the most a website can have. Remove some and save again.`;
}

/**
 * Which column of an imported CSV holds the product URLs.
 *
 * The `url` column when the file has a header row; otherwise the first column,
 * provided its first cell really is a URL — a one-column export with no header
 * is the commonest shape a customer sends, and refusing it outright would be
 * pedantry. Anything else is refused by name rather than silently importing the
 * wrong column.
 */
export function csvUrlCells(table: string[][]): { cells: string[] } | { error: string } {
  const header = (table[0] ?? []).map((c) => c.trim().toLowerCase());
  const urlColumn = header.indexOf('url');
  if (urlColumn >= 0) return { cells: table.slice(1).map((row) => row[urlColumn] ?? '') };
  if (parseUrlLines(table[0]?.[0] ?? '').urls.length === 1) {
    return { cells: table.map((row) => row[0] ?? '') };
  }
  return { error: 'That file needs a "url" column, or one column of URLs and no header row.' };
}

/** Appending an import to whatever is already in the box, without gluing two URLs together. */
export function appendUrls(existing: string, urls: string[]): string {
  return existing.trim() === '' ? urls.join('\n') : `${existing.replace(/\n+$/, '')}\n${urls.join('\n')}`;
}

function isEmptyCell(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Which contract columns came back empty on at least one sampled row, and on how
 * many. `key` looks the cell up; the note says the field's plain-language
 * `name`, because that is what the customer chose and what the table header two
 * elements up already reads.
 */
export function emptyCellCounts(
  rows: Array<Record<string, unknown>>,
  columns: Array<{ key: string; name: string }>,
): Array<{ name: string; emptyOn: number; sampled: number }> {
  if (rows.length === 0) return [];
  const out: Array<{ name: string; emptyOn: number; sampled: number }> = [];
  for (const column of columns) {
    const emptyOn = rows.filter((row) => isEmptyCell(row[column.key])).length;
    if (emptyOn > 0) out.push({ name: column.name, emptyOn, sampled: rows.length });
  }
  return out;
}

/** A sample row counts as complete when every contract column on it is filled. */
export function completeRowCount(
  rows: Array<Record<string, unknown>>,
  columns: Array<{ key: string }>,
): number {
  return rows.filter((row) => columns.every((c) => !isEmptyCell(row[c.key]))).length;
}
