import { describe, it, expect } from 'vitest';
import { cellText, outputView } from './output-view';

const NOW = new Date('2026-09-21T12:00:00Z');

describe('cellText', () => {
  it('renders every value as the customer would read it', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText('Chair')).toBe('Chair');
    expect(cellText(12.5)).toBe('12.5');
    expect(cellText(true)).toBe('true');
    expect(cellText(['a', 'b'])).toBe('a, b');
    expect(cellText({ x: 1 })).toBe('{"x":1}');
  });
});

describe('outputView', () => {
  it('hides provenance columns, stringifies cells, and summarises', () => {
    const v = outputView(
      {
        fields: ['Website', 'Title', 'Price', '_url'],
        rows: [{ Website: 'Alpha', Title: 'Chair', Price: 10, _url: 'https://a/1' }, { Website: 'Beta', Title: null, Price: '20' }],
        rowCount: 2,
        websites: [
          { id: 'a', name: 'Alpha', runId: 'r1', completedAt: '2026-09-21T09:00:00Z', rowCount: 1 },
          { id: 'b', name: 'Beta', runId: 'r2', completedAt: '2026-09-20T09:00:00Z', rowCount: 1 },
        ],
      },
      NOW,
    );
    expect(v.columns).toEqual(['Website', 'Title', 'Price']);
    expect(v.rows).toEqual([['Alpha', 'Chair', '10'], ['Beta', '', '20']]);
    expect(v).toMatchObject({ shown: 2, total: 2, truncated: false, summary: '2 websites · 2 rows · latest 3 h ago' });
  });

  it('says when the browser shows fewer rows than the file has', () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ Website: 'A', Title: `t${i}` }));
    const v = outputView({ fields: ['Website', 'Title'], rows, rowCount: 1200, websites: [{ id: 'a', name: 'A', runId: 'r', completedAt: '2026-09-21T11:00:00Z', rowCount: 1200 }] }, NOW);
    expect(v).toMatchObject({ shown: 500, total: 1200, truncated: true, summary: '1 website · 1200 rows · latest 1 h ago' });
  });

  it('with nothing run yet', () => {
    expect(outputView({ fields: ['Website'], rows: [], rowCount: 0, websites: [{ id: 'a', name: 'A', runId: null, completedAt: null, rowCount: 0 }] }, NOW).summary).toBe('No rows yet');
  });
});
