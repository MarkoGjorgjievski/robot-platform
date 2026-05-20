import { findEntitySubtree } from '@robot/scraper';

export type AnalysisSource = {
  url: string;
  responseBody: string;
  bodySize: number;
  method: string;
};

type CollectInput = {
  interceptedRequests: Array<{
    url: string;
    responseBody: string | null;
    bodySize: number;
    method: string;
  }>;
  structuredData: {
    nextData: Record<string, unknown> | null;
    ldJson: Record<string, unknown>[];
    [extra: string]: unknown;
  };
};

const MIN_INTERCEPTED_SIZE = 500;
const MIN_LDJSON_SIZE = 200;
const MAX_SOURCES = 5;

export function collectAiAnalysisSources(input: CollectInput): AnalysisSource[] {
  const sources: AnalysisSource[] = [];

  for (const r of input.interceptedRequests) {
    if (r.responseBody && r.bodySize > MIN_INTERCEPTED_SIZE) {
      sources.push({ url: r.url, responseBody: r.responseBody, bodySize: r.bodySize, method: r.method });
    }
  }

  if (input.structuredData.nextData) {
    const subtree = findEntitySubtree(input.structuredData.nextData);
    const target = subtree.score >= 2 ? subtree.value : input.structuredData.nextData;
    const body = JSON.stringify(target);
    sources.push({
      url: subtree.score >= 2 ? `inline://nextdata${subtree.path.slice(1)}` : 'inline://nextdata',
      responseBody: body,
      bodySize: body.length,
      method: 'INLINE',
    });
  }

  for (let i = 0; i < input.structuredData.ldJson.length; i++) {
    const body = JSON.stringify(input.structuredData.ldJson[i]);
    if (body.length > MIN_LDJSON_SIZE) {
      sources.push({
        url: `inline://ld+json[${i}]`,
        responseBody: body,
        bodySize: body.length,
        method: 'INLINE',
      });
    }
  }

  // Structured-data (inline://) sources are the highest-signal, lowest-noise
  // inputs (esp. after entity-subtree scoping shrinks nextData). Never let the
  // size cap evict them in favor of large junk intercepted requests. Keep all
  // inline sources first, then fill the remaining slots with the largest
  // intercepted bodies.
  const inline = sources.filter((s) => s.url.startsWith('inline://'));
  const intercepted = sources
    .filter((s) => !s.url.startsWith('inline://'))
    .sort((a, b) => b.bodySize - a.bodySize);
  return [...inline, ...intercepted].slice(0, MAX_SOURCES);
}
