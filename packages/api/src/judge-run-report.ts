// Pure parts of the judge-run CLI (src/judge-run.ts): verdict counting, the
// spend cap, local verdicts, and the Markdown report. No I/O, so it is
// unit-tested with fixed inputs; the CLI only gathers verdicts and hands them here.

import type { JudgeVerdict } from '@robot/agent';

export type { JudgeVerdict };
/**
 * A cell's outcome: a judge verdict, `empty` for a value that was never judged,
 * or `skipped` for a variant list (not judged here).
 */
export type CellVerdict = JudgeVerdict | 'empty' | 'skipped';

export type Cell = {
  /** The contract field key (the key in `extractions.data`). */
  field: string;
  value: unknown;
  verdict: CellVerdict;
  /** Which screenshot tile (1-based) decided a judged verdict; absent for local verdicts. */
  tile?: number;
  /** True when the verdict was set here without a judge call (a URL value is `unverifiable`). */
  local?: boolean;
  /** For a `wrong` verdict: the judge's uncalibrated reading of what the page shows. */
  judgeReading?: string;
};

export type ItemResult = {
  url: string;
  /** The captured page's <title>, so a bot wall or error page is visible in the report. */
  title?: string;
  cells: Cell[];
  /** Set when the page could not be captured; the item then has no verdicts. */
  captureError?: string;
};

export type FieldDef = { key: string; name: string; type?: string };

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
        if (c.verdict === 'skipped') continue;
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
  const judged = cells.filter((c) => !c.local && c.verdict !== 'empty' && c.verdict !== 'skipped');
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
  }
}

/** A per-item table cell: the verdict letter plus the tile that decided it (C1, N3); local verdicts have no tile. */
export function cellMark(c: Cell): string {
  return `${verdictLetter(c.verdict)}${c.tile != null && !c.local ? c.tile : ''}`;
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
const cellText = (s: string) => s.replace(/\|/g, '\\|').replace(/`/g, '\\`').replace(/\s+/g, ' ');
function showValue(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return cellText(s.length > 160 ? `${s.slice(0, 160)}…` : s);
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

export function renderReport(r: ReportInput): string {
  const L: string[] = [];
  const minutes = Math.floor(r.durationMs / 60_000);
  const seconds = Math.round((r.durationMs % 60_000) / 1000);
  const captured = r.items.filter((i) => !i.captureError).length;
  const failed = r.items.length - captured;
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
    `- Time: ${minutes}m ${seconds}s`,
    '',
    "Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.",
    '',
    `The judge sees screenshot tiles from the top of the page (${r.tiles} tiles ≈ ${r.tiles * r.tileHeight} px, ${r.tileHeight} px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.`,
    '',
    "Only each item's first stored row is judged (on a row-per-variant run, the default variant).",
    '',
    '## Per field', '',
    'Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.', '',
    ...summaryTable(r.fields, r.items),
    '',
    '## Per item', '',
    'C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · `·` empty. The digit is the screenshot tile that decided the verdict. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.', '',
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
      L.push(`- **${nameOf(c.field)}** — ${item.url}${c.tile != null ? ` (tile ${c.tile})` : ''}`,
        `  - extracted: \`${showValue(c.value)}\``,
        `  - judge's reading (uncalibrated): ${c.judgeReading ? cellText(c.judgeReading) : '(none returned)'}`);
    }
  }

  L.push('', '## Notes', '',
    '```', r.usageText, '```', '',
    '- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.',
    '- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.',
    '');
  return L.join('\n');
}
