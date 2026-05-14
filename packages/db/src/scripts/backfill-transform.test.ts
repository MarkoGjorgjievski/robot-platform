import { describe, it, expect } from 'vitest';
import { quickExtractionsToSandboxRecords, slugifyDomain } from './backfill-transform.js';

describe('slugifyDomain', () => {
  it('lowercases and replaces dots with hyphens', () => {
    expect(slugifyDomain('Amazon.COM')).toBe('amazon-com');
  });

  it('strips leading www.', () => {
    expect(slugifyDomain('www.example.com')).toBe('example-com');
  });

  it('handles bare hostnames', () => {
    expect(slugifyDomain('news.ycombinator.com')).toBe('news-ycombinator-com');
  });
});

describe('quickExtractionsToSandboxRecords', () => {
  const projectId = '00000000-0000-0000-0000-000000000001';

  it('produces one Source per unique URL', () => {
    const rows = [
      { url: 'https://example.com/a', domain: 'example.com', fields: [], extractedData: [] },
      { url: 'https://example.com/a', domain: 'example.com', fields: [], extractedData: [] },
      { url: 'https://example.com/b', domain: 'example.com', fields: [], extractedData: [] },
    ];
    const out = quickExtractionsToSandboxRecords(rows, projectId);
    expect(out.sources).toHaveLength(2);
    expect(out.sources.map((s) => s.urlTemplate).sort()).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('marks every Source as sandbox', () => {
    const out = quickExtractionsToSandboxRecords(
      [{ url: 'https://example.com', domain: 'example.com', fields: [], extractedData: [] }],
      projectId,
    );
    expect(out.sources[0].isSandbox).toBe(true);
    expect(out.sources[0].inputStrategy).toBe('direct');
    expect(out.sources[0].listingMode).toBe('detail');
    expect(out.sources[0].datasetId).toBeNull();
  });

  it('produces a paired inline InputSet for each Source', () => {
    const out = quickExtractionsToSandboxRecords(
      [{ url: 'https://example.com/x', domain: 'example.com', fields: [], extractedData: [] }],
      projectId,
    );
    expect(out.inputSets).toHaveLength(1);
    expect(out.inputSets[0].isInline).toBe(true);
    expect(out.inputSets[0].type).toBe('direct');
    expect(out.inputSets[0].projectId).toBe(projectId);
    expect(out.inputSets[0].rows).toEqual([{ url: 'https://example.com/x' }]);
    expect(out.inputSets[0].columns).toEqual([{ name: 'url', primary: true, type: 'string' }]);
    expect(out.sourceToInputSetIndex[0]).toBe(0);
  });

  it('produces an auto-display-name from the domain plus URL path', () => {
    const out = quickExtractionsToSandboxRecords(
      [{ url: 'https://amazon.com/dp/B0CHX1W1XY', domain: 'amazon.com', fields: [], extractedData: [] }],
      projectId,
    );
    expect(out.sources[0].name).toBe('amazon.com /dp/B0CHX1W1XY');
  });

  it('preserves quick_extraction fields jsonb as the Source schema preview', () => {
    const fields = [{ name: 'price', type: 'number' }];
    const out = quickExtractionsToSandboxRecords(
      [{ url: 'https://example.com', domain: 'example.com', fields, extractedData: [] }],
      projectId,
    );
    expect(out.sources[0].selectorsJson).toEqual({ fields });
  });

  it('returns empty arrays for empty input', () => {
    const out = quickExtractionsToSandboxRecords([], projectId);
    expect(out.sources).toEqual([]);
    expect(out.inputSets).toEqual([]);
    expect(out.sourceToInputSetIndex).toEqual([]);
  });

  it('generates a slug derived from domain + a counter for collisions', () => {
    const rows = [
      { url: 'https://example.com/a', domain: 'example.com', fields: [], extractedData: [] },
      { url: 'https://example.com/b', domain: 'example.com', fields: [], extractedData: [] },
    ];
    const out = quickExtractionsToSandboxRecords(rows, projectId);
    const slugs = out.sources.map((s) => s.slug).sort();
    expect(slugs[0]).toMatch(/^example-com-/);
    expect(slugs[1]).toMatch(/^example-com-/);
    expect(slugs[0]).not.toBe(slugs[1]);
  });
});
