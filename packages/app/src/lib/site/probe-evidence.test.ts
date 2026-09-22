import { describe, it, expect } from 'vitest';
import { probeEvidence } from './probe-evidence';

describe('probeEvidence', () => {
  it('reports pages walked and items found from the work-list counts', () => {
    const result = probeEvidence({ counts: { listing: 2, detail: 5 }, warnings: [] });
    expect(result.pagesWalked).toBe(2);
    expect(result.itemsFound).toBe(5);
  });

  it('counts the warnings it was given', () => {
    const result = probeEvidence({
      counts: { listing: 1, detail: 3 },
      warnings: ['budget reached: 40 items', 'a second one'],
    });
    expect(result.warningsCount).toBe(2);
  });

  it('reports "not reported" for pagination when no pagination-related warning is present', () => {
    const result = probeEvidence({ counts: { listing: 3, detail: 10 }, warnings: ['budget reached: 40 items'] });
    expect(result.paginationNote).toBe('not reported');
  });

  it('reports the no-pagination case distinctly', () => {
    const result = probeEvidence({
      counts: { listing: 1, detail: 4 },
      warnings: ['no pagination detected on https://x.example — planned page 1 only'],
    });
    expect(result.paginationNote).toBe('none detected — single page');
  });

  it('extracts the strategy named inside a "pagination (source: strategy)" warning', () => {
    const result = probeEvidence({
      counts: { listing: 2, detail: 4 },
      warnings: ['pagination (fresh: url-pattern) gained only 1 new item(s) on https://x — re-serving page 1'],
    });
    expect(result.paginationNote).toBe('fresh: url-pattern');
  });

  it('prefers the pagination-strategy warning over the no-pagination warning when both are somehow present', () => {
    const result = probeEvidence({
      counts: { listing: 2, detail: 4 },
      warnings: [
        'no pagination detected on https://x.example — planned page 1 only',
        'pagination (cache: dom-scroll) produced no new items on https://x.example',
      ],
    });
    expect(result.paginationNote).toBe('cache: dom-scroll');
  });

  it('handles zero pages/items/warnings cleanly', () => {
    const result = probeEvidence({ counts: { listing: 0, detail: 0 }, warnings: [] });
    expect(result).toEqual({
      pagesWalked: 0,
      itemsFound: 0,
      warningsCount: 0,
      paginationNote: 'not reported',
    });
  });
});
