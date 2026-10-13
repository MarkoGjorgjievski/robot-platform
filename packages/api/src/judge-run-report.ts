// Pure parts of the judge-run CLI (src/judge-run.ts): verdict counting, the
// spend cap, local verdicts, and the Markdown report. No I/O, so it is
// unit-tested with fixed inputs; the CLI only gathers verdicts and hands them here.

import type { JudgeVerdict } from '@robot/agent';

export type { JudgeVerdict };
/**
 * A cell's outcome: a judge verdict, `empty` for a value that was never judged,
 * `skipped` for a variant list (not judged here), or `not-judged` for a value
 * left unjudged because the run was interrupted.
 */
export type CellVerdict = JudgeVerdict | 'empty' | 'skipped' | 'not-judged';

export type Cell = {
  /** The contract field key (the key in `extractions.data`). */
  field: string;
  value: unknown;
  verdict: CellVerdict;
  /** Which screenshot tile (1-based) decided a judged verdict; absent for local verdicts. */
  tile?: number;
  /** True when the verdict was set here without a judge call (a URL value is `unverifiable`; a value found in the page text is `correct`). */
  local?: boolean;
  /**
   * How the verdict was reached: `text` — found in the page's visible text, no
   * call (judge-local.ts: a number with its field word beside it, or a long
   * text's first 80 characters, once); `prefix` — a long text value
   * judged on its first 80 characters; `judge` — the value judged whole. Absent
   * on empty, skipped and URL cells.
   */
  how?: 'text' | 'prefix' | 'judge';
  /** For a `wrong` verdict: the judge's uncalibrated reading of what the page shows. */
  judgeReading?: string;
  /**
   * The free "shown on the page" flag stored on the run's extraction (spec
   * 2026-10-12 §3/§4), read off `extractions.validation_result.shown[field]`:
   * `true`/`false` when the field was checkable, `null` when its type is not
   * (`url`, `image`, `boolean`, `date`), `undefined` when the run stored no
   * flag at all (a row from before this feature, or a non-certified run).
   * Set only on a judged or locally-settled cell — never on `empty`, `skipped`
   * or `not-judged`.
   */
  shown?: boolean | null;
  /** The run wrote the website's default here (spec 2026-10-13 §7): judged like any value, left out of the shown-flag confusion. */
  defaulted?: true;
};

export type ItemResult = {
  url: string;
  /** The captured page's <title>, so a bot wall or error page is visible in the report. */
  title?: string;
  cells: Cell[];
  /** Set when the page could not be captured; the item then has no verdicts. */
  captureError?: string;
};

/** A contract field; `concept` (product_name, brand, …) keeps names and brands out of the long-text local pass. */
export type FieldDef = { key: string; name: string; type?: string; concept?: string };

export type FieldSummary = {
  field: string;
  name: string;
  /** Cells with a verdict from the judge or a local verdict (everything but empty/skipped). */
  judged: number;
  correct: number;
  wrong: number;
  notOnPage: number;
  unverifiable: number;
  error: number;
  empty: number;
  /** correct / (correct + wrong) x 100; null when that denominator is 0. */
  correctnessPct: number | null;
};

/** Measured judge cost per call (docs/testing/results/2026-09-02T13-30-dogfood.md). */
export const JUDGE_USD_PER_FIELD = 0.0086;
/** Allowance on top of one call per value, for explain calls and further-tile retries. */
export const RETRY_ALLOWANCE = 0.1;

export function isEmptyValue(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

const URL_TYPES = new Set(['image', 'url']);
/** A URL-valued cell: a screenshot can neither confirm nor deny it, so it is `unverifiable` without a judge call. */
export function isUrlValued(type: string | undefined, value: unknown): boolean {
  if (type && URL_TYPES.has(type)) return true;
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

export function summarize(fields: FieldDef[], items: ItemResult[]): FieldSummary[] {
  return fields.map((f) => {
    const s: FieldSummary = { field: f.key, name: f.name, judged: 0, correct: 0, wrong: 0, notOnPage: 0, unverifiable: 0, error: 0, empty: 0, correctnessPct: null };
    for (const item of items) {
      if (item.captureError) continue;
      for (const c of item.cells) {
        if (c.field !== f.key) continue;
        if (c.verdict === 'empty') { s.empty++; continue; }
        if (c.verdict === 'skipped' || c.verdict === 'not-judged') continue;
        s.judged++;
        if (c.verdict === 'correct') s.correct++;
        else if (c.verdict === 'wrong') s.wrong++;
        else if (c.verdict === 'not-on-page') s.notOnPage++;
        else if (c.verdict === 'unverifiable') s.unverifiable++;
        else s.error++;
      }
    }
    const decided = s.correct + s.wrong;
    s.correctnessPct = decided === 0 ? null : (s.correct / decided) * 100;
    return s;
  });
}

/** The estimate the cap is checked against before an item: one call per value plus the retry allowance. */
export function estimateItemUsd(valuesToJudge: number): number {
  return valuesToJudge * JUDGE_USD_PER_FIELD * (1 + RETRY_ALLOWANCE);
}

/** True when `spentUsd` (actual so far plus the next item's estimate) goes over the cap. */
export function shouldStop(spentUsd: number, maxUsd: number): boolean {
  return spentUsd > maxUsd;
}

/** True when the judge called something on this item and every such cell is not-on-page (on every tile) — a bot wall or blank page looks like this. */
export function pageShowsNothing(cells: Cell[]): boolean {
  // A value found in the page's text means the page is the product page.
  if (cells.some((c) => c.how === 'text')) return false;
  const judged = cells.filter((c) => !c.local && c.verdict !== 'empty' && c.verdict !== 'skipped' && c.verdict !== 'not-judged');
  return judged.length > 0 && judged.every((c) => c.verdict === 'not-on-page');
}

export function verdictLetter(v: CellVerdict): string {
  switch (v) {
    case 'correct': return 'C';
    case 'wrong': return 'W';
    case 'not-on-page': return 'N';
    case 'unverifiable': return 'U';
    case 'error': return 'E';
    case 'empty': return '·';
    case 'skipped': return 'S';
    case 'not-judged': return '-';
  }
}

/**
 * A per-item table cell: the verdict letter plus the tile that decided it (C1, N3);
 * local verdicts have no tile. A value settled from the page text reads `Ct`; a
 * long text judged on its first 80 characters carries a trailing `p` (C1p).
 */
export function cellMark(c: Cell): string {
  if (c.how === 'text') return `${verdictLetter(c.verdict)}t`;
  return `${verdictLetter(c.verdict)}${c.tile != null && !c.local ? c.tile : ''}${c.how === 'prefix' ? 'p' : ''}`;
}

/** Cells settled from the page's visible text without a judge call. */
export function settledFromText(items: ItemResult[]): number {
  return items.reduce((n, i) => n + (i.captureError ? 0 : i.cells.filter((c) => c.how === 'text').length), 0);
}

export type AbortReason = 'pages-show-nothing' | 'interrupted' | 'judge-errors';

export type ReportInput = {
  runId: string;
  site: string;
  project: string;
  /** ISO time the judging started. */
  when: string;
  durationMs: number;
  fields: FieldDef[];
  /** The items actually processed, in stored order. */
  items: ItemResult[];
  /** Detail items the run holds. */
  itemsInRun: number;
  /** Detail items with stored values. */
  itemsWithValues: number;
  /** What limited the judged count below itemsWithValues, if anything. */
  limitedBy?: '--max-items' | 'cap' | 'abort';
  /** Tiles judged per value at most, and the tile height in page pixels. */
  tiles: number;
  tileHeight: number;
  costUsd: number;
  /** formatUsage() output for the judge calls. */
  usageText: string;
  maxUsd: number;
  stoppedByCap: boolean;
  abortReason?: AbortReason;
};

const ABORT_TEXT: Record<AbortReason, string> = {
  'pages-show-nothing': 'pages-show-nothing — 3 items in a row had every judged value not on page on every tile (a bot wall, challenge or error page?). Check the page titles below.',
  interrupted: 'interrupted — stopped by Ctrl+C.',
  'judge-errors': 'judge-errors — the judge returned 10 errors in a row (API unavailable?).',
};

const pct = (p: number | null) => (p == null ? '—' : `${Math.round(p)}%`);
/** Plain report text (table cells, titles, the judge's reading — never inside a code span): pipes and backticks backslash-escaped, which is valid outside a code span; whitespace collapsed. */
const cellText = (s: string) => s.replace(/\|/g, '\\|').replace(/`/g, '\\`').replace(/\s+/g, ' ');
/** A Markdown code span fenced with one more backtick than the longest run inside, padded with spaces; nothing is escaped inside it (backslashes are literal there). */
export function codeSpan(s: string): string {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  return longest > 0 ? `${fence} ${s} ${fence}` : `${fence}${s}${fence}`;
}
function showValue(v: unknown): string {
  const s = (typeof v === 'string' ? v : JSON.stringify(v)).replace(/\s+/g, ' ');
  return codeSpan(s.length > 160 ? `${s.slice(0, 160)}…` : s);
}

export function summaryTable(fields: FieldDef[], items: ItemResult[]): string[] {
  const out = [
    '| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const s of summarize(fields, items)) {
    out.push(`| ${cellText(s.name)} | ${s.judged} | ${s.correct} | ${s.wrong} | ${s.notOnPage} | ${s.unverifiable} | ${s.error} | ${s.empty} | ${pct(s.correctnessPct)} |`);
  }
  return out;
}

export type Confusion = {
  wrongNotShown: number;
  wrongShown: number;
  correctNotShown: number;
  correctShown: number;
  /** No flag was stored, or the field's type is not checkable (`url`/`image`/`boolean`/`date`); either way the free check says nothing. */
  unflagged: number;
  /** Every cell judged `wrong`, flagged or not. The sentence's "caught n of m" uses only the flagged ones (`wrongNotShown + wrongShown`). */
  wrongTotal: number;
};

/**
 * How the free "shown on the page" flag (spec 2026-10-12 §3/§6) lines up with
 * the judge's paid verdict, among cells the judge (or the local text pass)
 * called `correct` or `wrong` — every other verdict (not-on-page,
 * unverifiable, error, empty, skipped, not-judged) is outside the question
 * the flag is meant to answer. Items whose capture failed are ignored, same
 * as `summarize`.
 */
export function confusionCounts(items: ItemResult[]): Confusion {
  const c: Confusion = { wrongNotShown: 0, wrongShown: 0, correctNotShown: 0, correctShown: 0, unflagged: 0, wrongTotal: 0 };
  for (const item of items) {
    if (item.captureError) continue;
    for (const cell of item.cells) {
      if (cell.verdict !== 'wrong' && cell.verdict !== 'correct') continue;
      const wrong = cell.verdict === 'wrong';
      if (wrong) c.wrongTotal++;
      if (cell.defaulted || cell.shown == null) { c.unflagged++; continue; }
      if (cell.shown) { if (wrong) c.wrongShown++; else c.correctShown++; }
      else { if (wrong) c.wrongNotShown++; else c.correctNotShown++; }
    }
  }
  return c;
}

/** The confusion table and its one-sentence takeaway, for the report's summary. */
export function confusionTable(items: ItemResult[]): string[] {
  const c = confusionCounts(items);
  // Final review M3: the catch rate is out of the wrong values the flag had a
  // say on — an unflagged wrong value is neither caught nor missed.
  const flaggedWrong = c.wrongNotShown + c.wrongShown;
  return [
    '| Shown flag vs. verdict | Count |',
    '|---|---:|',
    `| Wrong & not shown | ${c.wrongNotShown} |`,
    `| Wrong & shown | ${c.wrongShown} |`,
    `| Correct & not shown | ${c.correctNotShown} |`,
    `| Correct & shown | ${c.correctShown} |`,
    `| Unflagged (no flag or not checkable) | ${c.unflagged} |`,
    '',
    `The free flag caught ${c.wrongNotShown} of the ${flaggedWrong} flagged wrong value${flaggedWrong === 1 ? '' : 's'}; it flagged ${c.correctNotShown} correct value${c.correctNotShown === 1 ? '' : 's'}.`,
  ];
}

/**
 * The flag's false positives, one per cell: a value the judge (or the local
 * text pass) called correct that the run flagged not shown — the cells needed
 * to tune the rule (final review M3). Items whose capture failed are ignored,
 * as in `confusionCounts`.
 */
export function correctNotShownCells(items: ItemResult[]): Array<{ url: string; field: string; value: unknown }> {
  return items.flatMap((item) => item.captureError ? [] : item.cells
    .filter((c) => c.verdict === 'correct' && c.shown === false)
    .map((c) => ({ url: item.url, field: c.field, value: c.value })));
}

/** `default` for a defaulted cell, else `true`/`false`/`—` for the shown flag — `—` covers both "no flag stored" and "not checkable" (null). */
export function shownText(c: Pick<Cell, 'shown' | 'defaulted'>): string {
  if (c.defaulted) return 'default';
  return c.shown === true ? 'true' : c.shown === false ? 'false' : '—';
}

export function renderReport(r: ReportInput): string {
  const L: string[] = [];
  const minutes = Math.floor(r.durationMs / 60_000);
  const seconds = Math.round((r.durationMs % 60_000) / 1000);
  const captured = r.items.filter((i) => !i.captureError).length;
  const failed = r.items.length - captured;
  const fromText = settledFromText(r.items);
  L.push(`# Judge run — ${r.site}`, '');
  if (r.stoppedByCap) {
    L.push(`> **STOPPED at the $${r.maxUsd.toFixed(2)} cap** — the next item would have gone over it.`,
      `> ${r.items.length} of ${r.itemsWithValues} items were judged; the tables cover only those.`, '');
  }
  if (r.abortReason) {
    L.push(`> **ABORTED: ${ABORT_TEXT[r.abortReason]}**`,
      `> ${r.items.length} of ${r.itemsWithValues} items were judged; the tables cover only those.`, '');
  }
  L.push(
    `- Run: \`${r.runId}\``,
    `- Site: ${r.site} (project ${r.project})`,
    `- When: ${r.when}`,
    `- Items: ${r.itemsInRun} items in run, ${r.itemsWithValues} with values, ${captured} captured, ${failed} capture failed, judged ${captured}${r.limitedBy ? ` (limited by ${r.limitedBy})` : ''}`,
    `- Fields: ${r.fields.map((f) => f.name).join(', ')}`,
    `- Judge cost: $${r.costUsd.toFixed(4)} (cap $${r.maxUsd.toFixed(2)})`,
    `- Note: per-call estimate not re-measured since page text was added ($${JUDGE_USD_PER_FIELD} a call — behind the cap and the saving below)`,
    `- ${fromText} value${fromText === 1 ? '' : 's'} settled from the page text without a call (saved at least $${(fromText * JUDGE_USD_PER_FIELD).toFixed(2)})`,
    `- Time: ${minutes}m ${seconds}s`,
    '',
    "Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.",
    '',
    "Some values are counted correct from the page's visible text without a judge call: a number with one of the field's words beside it (within 15 characters, nothing but spaces, colons or brackets between) or followed by \"/5\", \"out of 5\", \"stars\" or \"★\" (a single digit only right beside the field's name); a text value longer than 80 characters, not a product name or brand, whose first 80 characters occur exactly once in the page text. Money values always go to the judge. Every other value goes to the judge with page text beside the screenshot — 4,000 characters around the value when it is found, else the first 8,000; a text value longer than 80 characters is judged on its first 80, and the judge is told so.",
    '',
    `The judge sees screenshot tiles from the top of the page (${r.tiles} tiles ≈ ${r.tiles * r.tileHeight} px, ${r.tileHeight} px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.`,
    '',
    "Only each item's first stored row is judged (on a row-per-variant run, the default variant).",
    '',
    '## Per field', '',
    'Correct includes values settled from the page text without a call. Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.', '',
    ...summaryTable(r.fields, r.items),
    '',
    '## Shown flag vs. verdict', '',
    'How well the free "shown on the page" flag (spec 2026-10-12 §3/§6, stored per field on a certified run\'s extraction) predicts the judge\'s paid verdict, among cells the judge or the local text pass called correct or wrong; a cell with no stored flag, or whose field type is not checkable, counts as unflagged, not as either side.', '',
    ...confusionTable(r.items),
    '',
    '## Per item', '',
    'C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. Ct is a value found in the page text (a number with its field word beside it, or a long text\'s first 80 characters), without a judge call or cost; a trailing p means a long text judged on its first 80 characters. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.', '',
    `| URL | Page title | ${r.fields.map((f) => cellText(f.name)).join(' | ')} |`,
    `|---|---|${r.fields.map(() => ':-:').join('|')}|`,
  );
  for (const item of r.items) {
    if (item.captureError) { L.push(`| ${item.url} | capture failed: ${cellText(item.captureError)} |`); continue; }
    const marks = r.fields.map((f) => {
      const c = item.cells.find((x) => x.field === f.key);
      return c ? cellMark(c) : '·';
    });
    L.push(`| ${item.url} | ${cellText(item.title ?? '')} | ${marks.join(' | ')} |`);
  }

  L.push('', '## Wrong values', '');
  const wrong = r.items.flatMap((item) => item.cells.filter((c) => c.verdict === 'wrong').map((c) => ({ item, c })));
  if (wrong.length === 0) {
    L.push('None.');
  } else {
    const nameOf = (key: string) => r.fields.find((f) => f.key === key)?.name ?? key;
    for (const { item, c } of wrong) {
      L.push(`- **${nameOf(c.field)}** — ${item.url}${c.tile != null ? ` (tile ${c.tile})` : ''}${c.how === 'prefix' ? ' (judged on its first 80 characters)' : ''}`,
        `  - extracted: ${showValue(c.value)}`,
        `  - shown: ${shownText(c)}`,
        `  - judge's reading (uncalibrated): ${c.judgeReading ? cellText(c.judgeReading) : '(none returned)'}`);
    }
  }

  L.push('', '## Correct values flagged not shown', '');
  const falseFlags = correctNotShownCells(r.items);
  if (falseFlags.length === 0) {
    L.push('None.');
  } else {
    const nameOf = (key: string) => r.fields.find((f) => f.key === key)?.name ?? key;
    for (const f of falseFlags) L.push(`- **${nameOf(f.field)}** — ${f.url}`, `  - extracted: ${showValue(f.value)}`);
  }

  L.push('', '## Notes', '',
    '```', r.usageText, '```', '',
    '- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.',
    '- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.',
    '');
  return L.join('\n');
}
