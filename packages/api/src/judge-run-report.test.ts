import { describe, it, expect } from 'vitest';
import { summarize, renderReport, shouldStop, verdictLetter, type ItemResult, type ReportInput } from './judge-run-report.js';

const fields = [
  { key: 'title', name: 'Title' },
  { key: 'price', name: 'Price' },
  { key: 'sku', name: 'SKU' },
];

const items: ItemResult[] = [
  {
    url: 'https://shop.example/p/1',
    cells: [
      { field: 'title', value: 'Red shoe', verdict: 'correct' },
      { field: 'price', value: 19.99, verdict: 'wrong', pageShows: 'The page shows $24.99.' },
      { field: 'sku', value: null, verdict: 'empty' },
    ],
  },
  {
    url: 'https://shop.example/p/2',
    cells: [
      { field: 'title', value: 'Blue shoe', verdict: 'correct' },
      { field: 'price', value: 21, verdict: 'correct' },
      { field: 'sku', value: 'AB-2', verdict: 'not-on-page' },
    ],
  },
  {
    url: 'https://shop.example/p/3',
    cells: [
      { field: 'title', value: 'Green shoe', verdict: 'unverifiable' },
      { field: 'price', value: 22, verdict: 'error' },
      { field: 'sku', value: '', verdict: 'empty' },
    ],
  },
];

describe('summarize', () => {
  it('counts verdicts per field, with uncertain = not-on-page + unverifiable + error, and empties apart', () => {
    const s = summarize(fields, items);
    expect(s.map((r) => r.field)).toEqual(['title', 'price', 'sku']);
    expect(s[0]).toMatchObject({ name: 'Title', judged: 3, correct: 2, wrong: 0, uncertain: 1, empty: 0 });
    expect(s[1]).toMatchObject({ judged: 3, correct: 1, wrong: 1, uncertain: 1, empty: 0 });
    expect(s[2]).toMatchObject({ judged: 1, correct: 0, wrong: 0, uncertain: 1, empty: 2 });
  });

  it('computes correctness as correct / judged, in percent', () => {
    const s = summarize(fields, items);
    expect(s[0]!.correctnessPct).toBeCloseTo(66.67, 1);
    expect(s[1]!.correctnessPct).toBeCloseTo(33.33, 1);
    expect(s[2]!.correctnessPct).toBe(0);
  });

  it('returns null correctness (not NaN) for a field with nothing judged', () => {
    const allEmpty: ItemResult[] = [{ url: 'u', cells: [{ field: 'title', value: null, verdict: 'empty' }] }];
    const s = summarize([{ key: 'title', name: 'Title' }], allEmpty);
    expect(s[0]).toMatchObject({ judged: 0, empty: 1, correctnessPct: null });
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

describe('shouldStop', () => {
  it('stops only when the projected spend goes over the cap', () => {
    expect(shouldStop(4.99, 5)).toBe(false);
    expect(shouldStop(5, 5)).toBe(false);
    expect(shouldStop(5.01, 5)).toBe(true);
  });
});

describe('verdictLetter', () => {
  it('maps every verdict to one letter', () => {
    expect(['correct', 'wrong', 'not-on-page', 'unverifiable', 'error', 'empty', 'skipped'].map((v) => verdictLetter(v as never)))
      .toEqual(['C', 'W', 'N', 'U', 'E', '·', 'S']);
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
  totalItems: 3,
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
    expect(md).toContain('Items judged: 3 / 3');
    expect(md).toContain('$0.0774');
    expect(md).toContain('| Title | 3 | 2 | 0 | 1 | 0 | 67% |');
    expect(md).toContain('| SKU | 1 | 0 | 0 | 1 | 2 | 0% |');
    expect(md).toContain('| https://shop.example/p/1 | C | W | · |');
    expect(md).toContain('## Wrong values');
    expect(md).toContain('19.99');
    expect(md).toContain('The page shows $24.99.');
    expect(md).toMatch(/process-wide/);
    expect(md).toMatch(/does not write to `runs.cost_usd`/);
    expect(md).not.toContain('STOPPED');
  });

  it('says a cap-stopped run is partial, in the header', () => {
    const md = renderReport({ ...base, items: items.slice(0, 1), stoppedByCap: true });
    expect(md).toContain('Items judged: 1 / 3');
    expect(md).toMatch(/STOPPED at the \$5\.00 cap/);
  });

  it('renders a dash for a field with nothing judged, and "none" when nothing was wrong', () => {
    const allEmpty: ItemResult[] = [{ url: 'u', cells: fields.map((f) => ({ field: f.key, value: null, verdict: 'empty' as const })) }];
    const md = renderReport({ ...base, items: allEmpty, totalItems: 1, costUsd: 0 });
    expect(md).toContain('| Title | 0 | 0 | 0 | 0 | 1 | — |');
    expect(md).not.toContain('NaN');
    expect(md).toMatch(/## Wrong values\s+None\./);
  });

  it('lists a failed capture in the item table', () => {
    const md = renderReport({ ...base, items: [{ url: 'https://x.example/', captureError: 'timeout', cells: [] }], totalItems: 1 });
    expect(md).toContain('| https://x.example/ | capture failed: timeout |');
  });
});
