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

  return [...sources].sort((a, b) => b.bodySize - a.bodySize).slice(0, MAX_SOURCES);
}
