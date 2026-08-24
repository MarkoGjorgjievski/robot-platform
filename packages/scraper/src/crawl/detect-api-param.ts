// Detect API pagination by PROVING it, not by guessing it.
//
// The HTML path picks a parameter by name and finds out whether it was right
// from item counts, days later, if a human notices. Here the answer is one small
// JSON fetch away, so the parameter is never used — and never cached — until a
// probe has shown it returns different data.

import type { IBrowser, PageCapture, PaginationConfig } from '@robot/browser';
import { collectFromJson } from './api-identifiers.js';
import { findListingApi } from './find-listing-api.js';
import {
  rankCandidates, probeUrl, templateFor, overlapShare, REPLAY_MAX_OVERLAP,
} from './api-param-candidates.js';
import { fetchInPage } from './api-param-fetch.js';

export type ApiParamDetection = {
  config: PaginationConfig;
  /** Every candidate probed, for the warning when none verifies. */
  tried: string[];
};

export async function detectApiParam(
  capture: PageCapture,
  page1Urls: string[],
  browser: IBrowser,
): Promise<ApiParamDetection | null> {
  const match = findListingApi(capture.interceptedRequests ?? [], page1Urls);
  if (!match) return null;

  const page1Ids = collectFromJson(match.request.parsedJson, match.itemsPath, match.urlPath);
  const pageSize = page1Ids.length;
  if (pageSize === 0) return null;

  const candidates = rankCandidates(match.request.url, pageSize);
  if (candidates.length === 0) return null;

  // One batch for every candidate: they are small JSON requests, and issuing
  // them together costs one navigation instead of one per hypothesis.
  const probes = candidates.map((c) => probeUrl(match.request.url, c));
  const bodies = await fetchInPage(browser, capture.url ?? match.request.url, probes);
  const byUrl = new Map(bodies.map((b) => [b.url, b]));

  const tried: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const body = byUrl.get(probes[i]!);
    tried.push(`${candidate.paramName}+${candidate.step}`);
    if (!body || body.error !== null || body.json === null) continue;
    if (body.status < 200 || body.status >= 300) continue;

    const probeIds = collectFromJson(body.json, match.itemsPath, match.urlPath);
    if (probeIds.length === 0) continue;
    // The load-bearing line: a probe that hands back page 1's items is a wrong
    // hypothesis, however well-formed its response.
    if (overlapShare(page1Ids, probeIds) > REPLAY_MAX_OVERLAP) continue;

    return {
      config: {
        strategy: 'api-param',
        apiTemplate: templateFor(match.request.url, candidate.paramName),
        paramName: candidate.paramName,
        step: candidate.step,
        itemsPath: match.itemsPath,
        urlPath: match.urlPath,
      },
      tried,
    };
  }

  return null;
}
