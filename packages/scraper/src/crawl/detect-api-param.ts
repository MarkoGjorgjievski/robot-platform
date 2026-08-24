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

/**
 * The full result of an attempt, including the cases `detectApiParam` collapses
 * to `null` — a caller that wants to warn about a failed attempt (naming the
 * endpoint and what was tried) needs `tried`/`endpoint` even when `config` is
 * null, which a `T | null` return can't carry.
 */
export type ApiParamAttempt = {
  config: PaginationConfig | null;
  tried: string[];
  /** The listing endpoint that was probed, or null if none was even found. */
  endpoint: string | null;
};

const NO_ATTEMPT: ApiParamAttempt = { config: null, tried: [], endpoint: null };

/**
 * Attempt api-param detection, in full — never throws.
 *
 * Detection is an optimisation layered on top of work that is already planned
 * (spec §3): a bad response, a malformed candidate, or — historically — a
 * relative endpoint URL reaching `new URL()` in `api-param-candidates.ts` must
 * degrade to "nothing found", exactly as `fetchInPage` degrades a page-context
 * failure to `[]`, never propagate as a thrown error out of detection and cost
 * the caller page 1's already-planned items.
 */
export async function probeApiParam(
  capture: PageCapture,
  page1Urls: string[],
  browser: IBrowser,
): Promise<ApiParamAttempt> {
  try {
    return await probeApiParamUnsafe(capture, page1Urls, browser);
  } catch {
    return NO_ATTEMPT;
  }
}

async function probeApiParamUnsafe(
  capture: PageCapture,
  page1Urls: string[],
  browser: IBrowser,
): Promise<ApiParamAttempt> {
  const match = findListingApi(capture.interceptedRequests ?? [], page1Urls);
  if (!match) return NO_ATTEMPT;

  const page1Ids = collectFromJson(match.request.parsedJson, match.itemsPath, match.urlPath);
  const pageSize = page1Ids.length;
  // Belt-and-braces, not load-bearing: `findListingApi` only returns a match
  // once at least `API_MATCH_MIN_COUNT` (3) identifiers were found via these
  // SAME `itemsPath`/`urlPath`, so `page1Ids` — recomputed here with the same
  // paths — cannot come back empty for a `match`. Kept and labelled anyway,
  // per this file's convention (see the URL-invariant note in
  // `api-param-candidates.ts`), so a future reader does not mistake "cheap
  // defensive check" for "reachable branch".
  if (pageSize === 0) return { config: null, tried: [], endpoint: match.request.url };

  const candidates = rankCandidates(match.request.url, pageSize);
  // Also belt-and-braces: an empty `candidates` array falls through the loop
  // below to `return null` on its own (there is nothing to iterate), so this
  // early return changes no behaviour. It documents that fact rather than
  // leaving a reader to wonder whether skipping straight to the fallback here
  // is doing something the loop wouldn't.
  if (candidates.length === 0) return { config: null, tried: [], endpoint: match.request.url };

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
    if (!body) continue;
    // Split from `json === null` so each is independently deletable and
    // independently tested: a network/parse error and a bad HTTP status are
    // different failure modes, and a probe that trips one must not be mistaken
    // for a probe that trips the other.
    if (body.error !== null) continue;
    if (body.json === null) continue;
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
      endpoint: match.request.url,
    };
  }

  return { config: null, tried, endpoint: match.request.url };
}

/** Convenience wrapper over `probeApiParam` for callers that only care about success. */
export async function detectApiParam(
  capture: PageCapture,
  page1Urls: string[],
  browser: IBrowser,
): Promise<ApiParamDetection | null> {
  const attempt = await probeApiParam(capture, page1Urls, browser);
  return attempt.config ? { config: attempt.config, tried: attempt.tried } : null;
}
