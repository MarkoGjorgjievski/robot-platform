// Pure parts of the judge-run CLI (src/judge-run.ts): verdict counting, the
// spend cap, and the Markdown report. No I/O, so it is unit-tested with fixed
// inputs; the CLI only gathers verdicts and hands them here.

/** What the Tier 2 judge (@robot/agent judgeFieldExtraction) can return. */
export type JudgeVerdict = 'correct' | 'wrong' | 'not-on-page' | 'unverifiable' | 'error';
/** A cell's outcome: a judge verdict, `empty` for a value that was never judged, or `skipped` for a variant list (not judged here). */
export type CellVerdict = JudgeVerdict | 'empty' | 'skipped';

export type Cell = {
  /** The contract field key (the key in `extractions.data`). */
  field: string;
  value: unknown;
  verdict: CellVerdict;
  /** For a `wrong` verdict: what the page shows instead, in the judge's words. */
  pageShows?: string;
};

export type ItemResult = {
  url: string;
  cells: Cell[];
  /** Set when the page could not be captured; the item then has no verdicts. */
  captureError?: string;
};

export type FieldDef = { key: string; name: string };

export type FieldSummary = {
  field: string;
  name: string;
  judged: number;
  correct: number;
  wrong: number;
  /** not-on-page + unverifiable + error: judged, but neither confirmed nor refuted. */
  uncertain: number;
  empty: number;
  /** correct / judged x 100; null when nothing was judged. */
  correctnessPct: number | null;
};

/** Measured judge cost per field (docs/testing/results/2026-09-02T13-30-dogfood.md). */
export const JUDGE_USD_PER_FIELD = 0.0086;

export function isEmptyValue(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

export function summarize(fields: FieldDef[], items: ItemResult[]): FieldSummary[] {
  return fields.map((f) => {
    const s: FieldSummary = { field: f.key, name: f.name, judged: 0, correct: 0, wrong: 0, uncertain: 0, empty: 0, correctnessPct: null };
    for (const item of items) {
      if (item.captureError) continue;
      for (const c of item.cells) {
        if (c.field !== f.key) continue;
        if (c.verdict === 'empty') { s.empty++; continue; }
        if (c.verdict === 'skipped') continue;
        s.judged++;
        if (c.verdict === 'correct') s.correct++;
        else if (c.verdict === 'wrong') s.wrong++;
        else s.uncertain++;
      }
    }
    s.correctnessPct = s.judged === 0 ? null : (s.correct / s.judged) * 100;
    return s;
  });
}

/** True when `spentUsd` (actual so far plus what the next item would add) goes over the cap. */
export function shouldStop(spentUsd: number, maxUsd: number): boolean {
  return spentUsd > maxUsd;
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
  /** Every detail item the run holds, judged or not. */
  totalItems: number;
  costUsd: number;
  /** formatUsage() output for the judge calls. */
  usageText: string;
  maxUsd: number;
  stoppedByCap: boolean;
  /** Set when judging was aborted for a reason other than the cap. */
  abortReason?: string;
};

const pct = (p: number | null) => (p == null ? '—' : `${Math.round(p)}%`);
const cellText = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
function showValue(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return cellText(s.length > 160 ? `${s.slice(0, 160)}…` : s);
}

export function summaryTable(fields: FieldDef[], items: ItemResult[]): string[] {
  const out = ['| Field | Judged | Correct | Wrong | Uncertain | Empty | Correct % |', '|---|---:|---:|---:|---:|---:|---:|'];
  for (const s of summarize(fields, items)) {
    out.push(`| ${cellText(s.name)} | ${s.judged} | ${s.correct} | ${s.wrong} | ${s.uncertain} | ${s.empty} | ${pct(s.correctnessPct)} |`);
  }
  return out;
}

export function renderReport(r: ReportInput): string {
  const L: string[] = [];
  const minutes = Math.floor(r.durationMs / 60_000);
  const seconds = Math.round((r.durationMs % 60_000) / 1000);
  L.push(`# Judge run — ${r.site}`, '');
  if (r.stoppedByCap) {
    L.push(`> **STOPPED at the $${r.maxUsd.toFixed(2)} cap** — the next item would have gone over it.`,
      `> ${r.items.length} of ${r.totalItems} items were judged; the tables cover only those.`, '');
  }
  if (r.abortReason) {
    L.push(`> **ABORTED** — ${r.abortReason}`, `> ${r.items.length} of ${r.totalItems} items were judged; the tables cover only those.`, '');
  }
  L.push(
    `- Run: \`${r.runId}\``,
    `- Site: ${r.site} (project ${r.project})`,
    `- When: ${r.when}`,
    `- Items judged: ${r.items.length} / ${r.totalItems}`,
    `- Fields: ${r.fields.map((f) => f.name).join(', ')}`,
    `- Judge cost: $${r.costUsd.toFixed(4)} (cap $${r.maxUsd.toFixed(2)})`,
    `- Time: ${minutes}m ${seconds}s`,
    '',
    "Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.",
    '',
    '## Per field', '',
    'Correct % is correct / judged. Uncertain = not on page + unverifiable (URLs, IDs) + judge error. Empty values are not judged.', '',
    ...summaryTable(r.fields, r.items),
    '',
    '## Per item', '',
    'C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · `·` empty', '',
    `| URL | ${r.fields.map((f) => cellText(f.name)).join(' | ')} |`,
    `|---|${r.fields.map(() => ':-:').join('|')}|`,
  );
  for (const item of r.items) {
    if (item.captureError) { L.push(`| ${item.url} | capture failed: ${cellText(item.captureError)} |`); continue; }
    const letters = r.fields.map((f) => {
      const c = item.cells.find((x) => x.field === f.key);
      return c ? verdictLetter(c.verdict) : '·';
    });
    L.push(`| ${item.url} | ${letters.join(' | ')} |`);
  }

  L.push('', '## Wrong values', '');
  const wrong = r.items.flatMap((item) => item.cells.filter((c) => c.verdict === 'wrong').map((c) => ({ item, c })));
  if (wrong.length === 0) {
    L.push('None.');
  } else {
    const nameOf = (key: string) => r.fields.find((f) => f.key === key)?.name ?? key;
    for (const { item, c } of wrong) {
      L.push(`- **${nameOf(c.field)}** — ${item.url}`,
        `  - extracted: \`${showValue(c.value)}\``,
        `  - page shows: ${c.pageShows ? cellText(c.pageShows) : '(no explanation returned)'}`);
    }
  }

  L.push('', '## Notes', '',
    '```', r.usageText, '```', '',
    '- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.',
    '- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.',
    '');
  return L.join('\n');
}
