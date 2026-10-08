import { describe, it, expect } from 'vitest';
import {
  summarize, renderReport, shouldStop, verdictLetter, cellMark, isUrlValued, pageShowsNothing, estimateItemUsd,
  type ItemResult, type ReportInput,
} from './judge-run-report.js';

const fields = [
  { key: 'title', name: 'Title', type: 'text' },
  { key: 'price', name: 'Price', type: 'money' },
  { key: 'sku', name: 'SKU', type: 'text' },
];

const items: ItemResult[] = [
  {
    url: 'https://shop.example/p/1',
    title: 'Red shoe | Shop',
    cells: [
      { field: 'title', value: 'Red shoe', verdict: 'correct', tile: 1 },
      { field: 'price', value: 19.99, verdict: 'wrong', tile: 1, judgeReading: 'The page shows $24.99.' },
      { field: 'sku', value: null, verdict: 'empty' },
    ],
  },
  {
    url: 'https://shop.example/p/2',
    cells: [
      { field: 'title', value: 'Blue shoe', verdict: 'correct', tile: 1 },
      { field: 'price', value: 21, verdict: 'correct', tile: 2 },
      { field: 'sku', value: 'AB-2', verdict: 'not-on-page', tile: 3 },
    ],
  },
  {
    url: 'https://shop.example/p/3',
    cells: [
      { field: 'title', value: 'Green shoe', verdict: 'unverifiable', tile: 1 },
      { field: 'price', value: 22, verdict: 'error', tile: 1 },
      { field: 'sku', value: '', verdict: 'empty' },
    ],
  },
];

describe('summarize', () => {
  it('counts each verdict in its own column, empties apart', () => {
    const s = summarize(fields, items);
    expect(s.map((r) => r.field)).toEqual(['title', 'price', 'sku']);
    expect(s[0]).toMatchObject({ name: 'Title', judged: 3, correct: 2, wrong: 0, notOnPage: 0, unverifiable: 1, error: 0, empty: 0 });
    expect(s[1]).toMatchObject({ judged: 3, correct: 1, wrong: 1, notOnPage: 0, unverifiable: 0, error: 1, empty: 0 });
    expect(s[2]).toMatchObject({ judged: 1, correct: 0, wrong: 0, notOnPage: 1, empty: 2 });
  });

  it('computes correctness as correct / (correct + wrong), leaving uncertain verdicts out', () => {
    const s = summarize(fields, items);
    expect(s[0]!.correctnessPct).toBe(100);
    expect(s[1]!.correctnessPct).toBe(50);
  });

  it('returns null correctness (not NaN, not 0) when nothing was correct or wrong', () => {
    const s = summarize(fields, items);
    expect(s[2]!.correctnessPct).toBeNull();
    const allEmpty: ItemResult[] = [{ url: 'u', cells: [{ field: 'title', value: null, verdict: 'empty' }] }];
    expect(summarize([{ key: 'title', name: 'Title' }], allEmpty)[0]).toMatchObject({ judged: 0, empty: 1, correctnessPct: null });
  });

  it('counts a skipped variant list neither as judged nor as empty', () => {
    const s = summarize([{ key: 'v', name: 'V' }], [{ url: 'u', cells: [{ field: 'v', value: [{ sku: 'a' }], verdict: 'skipped' }] }]);
    expect(s[0]).toMatchObject({ judged: 0, empty: 0, correctnessPct: null });
  });

  it('ignores items whose capture failed', () => {
    const failed: ItemResult[] = [{ url: 'u', captureError: 'timeout', cells: [] }];
    const s = summarize(fields, failed);
    expect(s.every((r) => r.judged === 0 && r.empty === 0)).toBe(true);
  });
});

describe('shouldStop / estimateItemUsd', () => {
  it('stops only when the projected spend goes over the cap', () => {
    expect(shouldStop(4.99, 5)).toBe(false);
    expect(shouldStop(5, 5)).toBe(false);
    expect(shouldStop(5.01, 5)).toBe(true);
  });

  it('estimates an item at one call per value plus a 10% retry allowance', () => {
    expect(estimateItemUsd(10)).toBeCloseTo(10 * 0.0086 * 1.1, 6);
    expect(estimateItemUsd(0)).toBe(0);
  });
});

describe('isUrlValued', () => {
  it('treats image and url fields, and any absolute http(s) value, as URL-valued', () => {
    expect(isUrlValued('image', 'x.png')).toBe(true);
    expect(isUrlValued('url', '/p/1')).toBe(true);
    expect(isUrlValued('text', 'https://shop.example/a')).toBe(true);
    expect(isUrlValued('text', 'Red shoe')).toBe(false);
    expect(isUrlValued('money', 19.99)).toBe(false);
  });
});

describe('pageShowsNothing', () => {
  it('is true only when every judge-called cell is not-on-page', () => {
    expect(pageShowsNothing([
      { field: 'a', value: 1, verdict: 'not-on-page', tile: 3 },
      { field: 'b', value: 'https://x', verdict: 'unverifiable', local: true },
      { field: 'c', value: null, verdict: 'empty' },
    ])).toBe(true);
    expect(pageShowsNothing([
      { field: 'a', value: 1, verdict: 'not-on-page', tile: 3 },
      { field: 'b', value: 2, verdict: 'correct', tile: 1 },
    ])).toBe(false);
    expect(pageShowsNothing([{ field: 'c', value: null, verdict: 'empty' }])).toBe(false);
  });
});

describe('verdictLetter / cellMark', () => {
  it('maps every verdict to one letter', () => {
    expect(['correct', 'wrong', 'not-on-page', 'unverifiable', 'error', 'empty', 'skipped'].map((v) => verdictLetter(v as never)))
      .toEqual(['C', 'W', 'N', 'U', 'E', '·', 'S']);
  });

  it('adds the deciding tile to judged cells, none to local ones', () => {
    expect(cellMark({ field: 'a', value: 1, verdict: 'not-on-page', tile: 3 })).toBe('N3');
    expect(cellMark({ field: 'a', value: 'https://x', verdict: 'unverifiable', local: true })).toBe('U');
    expect(cellMark({ field: 'a', value: null, verdict: 'empty' })).toBe('·');
  });
});

const base: ReportInput = {
  runId: '30e85fa4-0362-4952-84b2-2a853a1e9e7f',
  site: 'Nike',
  project: 'Credit campaign',
  when: '2026-10-08T10:00:00.000Z',
  durationMs: 125_000,
  fields,
  items,
  itemsInRun: 4,
  itemsWithValues: 3,
  tiles: 3,
  tileHeight: 1536,
  costUsd: 0.0774,
  usageText: 'claude-sonnet-5: 9 req\nestimated $0.0774 at list rates',
  maxUsd: 5,
  stoppedByCap: false,
};

describe('renderReport', () => {
  it('has the header, both tables, the wrong values and the closing notes', () => {
    const md = renderReport(base);
    expect(md).toContain('# Judge run — Nike');
    expect(md).toContain('30e85fa4-0362-4952-84b2-2a853a1e9e7f');
    expect(md).toContain('4 items in run, 3 with values, 3 captured, 0 capture failed, judged 3');
    expect(md).not.toContain('limited by');
    expect(md).toContain('$0.0774');
    expect(md).toContain("'Not on page' after all tiles usually means further down or in a tab, not wrong.");
    expect(md).toContain('3 tiles ≈ 4608 px');
    expect(md).toMatch(/first stored row is judged/);
    expect(md).toContain('| Title | 3 | 2 | 0 | 0 | 1 | 0 | 0 | 100% |');
    expect(md).toContain('| Price | 3 | 1 | 1 | 0 | 0 | 1 | 0 | 50% |');
    expect(md).toContain('| SKU | 1 | 0 | 0 | 1 | 0 | 0 | 2 | — |');
    expect(md).toContain('| https://shop.example/p/1 | Red shoe \\| Shop | C1 | W1 | · |');
    expect(md).toContain('| https://shop.example/p/2 |  | C1 | C2 | N3 |');
    expect(md).toContain('## Wrong values');
    expect(md).toContain('19.99');
    expect(md).toContain("judge's reading (uncalibrated): The page shows $24.99.");
    expect(md).toMatch(/URL value .* without a judge call/);
    expect(md).toMatch(/process-wide/);
    expect(md).toMatch(/does not write to `runs.cost_usd`/);
    expect(md).not.toContain('STOPPED');
    expect(md).not.toContain('ABORTED');
  });

  it('says a cap-stopped run is partial, in the header', () => {
    const md = renderReport({ ...base, items: items.slice(0, 1), stoppedByCap: true, limitedBy: 'cap' });
    expect(md).toMatch(/STOPPED at the \$5\.00 cap/);
    expect(md).toContain('judged 1 (limited by cap)');
  });

  it('names the pages-show-nothing abort in the header', () => {
    const md = renderReport({ ...base, abortReason: 'pages-show-nothing', limitedBy: 'abort' });
    expect(md).toMatch(/ABORTED: pages-show-nothing/);
    expect(md).toContain('(limited by abort)');
  });

  it('renders a dash for a field with nothing decided, and "None." when nothing was wrong', () => {
    const allEmpty: ItemResult[] = [{ url: 'u', cells: fields.map((f) => ({ field: f.key, value: null, verdict: 'empty' as const })) }];
    const md = renderReport({ ...base, items: allEmpty, itemsWithValues: 1, costUsd: 0 });
    expect(md).toContain('| Title | 0 | 0 | 0 | 0 | 0 | 0 | 1 | — |');
    expect(md).not.toContain('NaN');
    expect(md).toMatch(/## Wrong values\s+None\./);
  });

  it('escapes backticks in a wrong value', () => {
    const md = renderReport({ ...base, items: [{ url: 'u', cells: [{ field: 'title', value: 'a`b', verdict: 'wrong', tile: 1 }] }] });
    expect(md).toContain('`a\\`b`');
  });

  it('lists a failed capture in the item table and the header counts', () => {
    const md = renderReport({ ...base, items: [{ url: 'https://x.example/', captureError: 'timeout', cells: [] }], itemsWithValues: 1 });
    expect(md).toContain('| https://x.example/ | capture failed: timeout |');
    expect(md).toContain('0 captured, 1 capture failed, judged 0');
  });
});
