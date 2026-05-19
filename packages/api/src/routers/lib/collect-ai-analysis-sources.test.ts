import { describe, it, expect } from 'vitest';
import { collectAiAnalysisSources } from './collect-ai-analysis-sources.js';

type Intercepted = {
  url: string;
  method: string;
  responseBody: string | null;
  bodySize: number;
};

const r = (url: string, responseBody: string | null, bodySize: number): Intercepted => ({
  url,
  method: 'GET',
  responseBody,
  bodySize,
});

describe('collectAiAnalysisSources', () => {
  it('includes intercepted requests over the size threshold', () => {
    const sources = collectAiAnalysisSources({
      interceptedRequests: [
        r('https://api.x/p/1', '{"price":10}', 1000),
        r('https://api.x/p/2', '{}', 5),
      ],
      structuredData: { nextData: null, ldJson: [], initialState: null, meta: {} },
    });
    expect(sources.map(s => s.url)).toEqual(['https://api.x/p/1']);
  });

  it('skips intercepted requests with null responseBody', () => {
    const sources = collectAiAnalysisSources({
      interceptedRequests: [r('https://api.x/p/1', null, 9999)],
      structuredData: { nextData: null, ldJson: [], initialState: null, meta: {} },
    });
    expect(sources).toEqual([]);
  });

  it('includes nextData as a synthetic source when present', () => {
    const sources = collectAiAnalysisSources({
      interceptedRequests: [],
      structuredData: {
        nextData: { props: { pageProps: { product: { title: 'X' } } } },
        ldJson: [],
        initialState: null,
        meta: {},
      },
    });
    expect(sources.map(s => s.url)).toContain('inline://nextdata');
  });

  it('includes large ldJson blobs as synthetic sources', () => {
    const big = { '@type': 'Product', name: 'X', description: 'long description'.repeat(40) };
    const sources = collectAiAnalysisSources({
      interceptedRequests: [],
      structuredData: { nextData: null, ldJson: [big], initialState: null, meta: {} },
    });
    expect(sources.find(s => s.url === 'inline://ld+json[0]')).toBeDefined();
  });

  it('skips small ldJson blobs (< 200 bytes when serialized)', () => {
    const tiny = { '@type': 'WebPage' };
    const sources = collectAiAnalysisSources({
      interceptedRequests: [],
      structuredData: { nextData: null, ldJson: [tiny], initialState: null, meta: {} },
    });
    expect(sources).toEqual([]);
  });

  it('caps the number of sources at 5, prefers richer (larger) sources', () => {
    const sources = collectAiAnalysisSources({
      interceptedRequests: Array.from({ length: 10 }, (_, i) =>
        r(`https://api.x/p/${i}`, `{"data":"${'x'.repeat(i * 100)}"}`, 1000 + i * 100)
      ),
      structuredData: {
        nextData: { props: 1 },
        ldJson: [{ a: 1 }],
        initialState: null,
        meta: {},
      },
    });
    expect(sources.length).toBeLessThanOrEqual(5);
    // The largest intercepted bodies should be preferred
    expect(sources[0].bodySize).toBeGreaterThanOrEqual(sources[sources.length - 1].bodySize);
  });
});
