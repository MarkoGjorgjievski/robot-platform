// Deciding HOW a listing paginates, before spending a page load finding out.
//
// Detection used to happen inside `browser.crawl()`, from page 1's HTML — which
// meant crawl() re-navigated to page 1 purely to look at markup the caller had
// already captured. Worse, when a page has NO pagination (most category pages
// with a carousel and nothing else), that wasted load bought nothing.
//
// Doing it here, from the capture, means: no extra fetch, the AI fallback finally
// has a caller, and the resulting config can be cached per domain later.

import type { IBrowser, PageCapture, PaginationConfig } from '@robot/browser';
import { detectPaginationFromHtml } from '@robot/browser';
import { probeApiParam, type ApiParamAttempt } from './detect-api-param.js';

/** The AI collaborator, declared structurally so tests need no API key. */
export type PaginationAgent = {
  detectPagination(html: string): Promise<{
    has_pagination: boolean;
    strategy: 'url-pattern' | 'next-button' | 'page-numbers' | 'none';
    url_template?: string;
    next_selector?: string;
    page_selector?: string;
  }>;
};

export type PaginationDetection = {
  config: PaginationConfig | null;
  /** Which tier answered — recorded so a bad config is traceable to its source. */
  source: 'cache' | 'api-param' | 'mechanical' | 'ai' | 'none';
  /**
   * Present whenever api-param failed to apply and there was genuinely
   * something to consider (at least one GET/JSON/2xx intercepted response),
   * whatever tier ultimately answered instead. This is the raw material for
   * tuning the heuristics in `api-param-candidates.ts` from real traffic — a
   * human reading `runs.logs` needs to see WHY, or a silent api-param miss is
   * indistinguishable from "there was no API to try".
   *
   * Gated on `considered > 0` rather than on an endpoint having been found: a
   * listing that made no JSON XHR at all has nothing to report, and the live
   * Newegg run showed the opposite gate (endpoint found) misses the case that
   * actually happens most — no listing API matched at all.
   */
  apiParamAttempt?: Omit<ApiParamAttempt, 'config'>;
};

export async function detectPagination(
  capture: PageCapture,
  agent: PaginationAgent | null,
  cached?: PaginationConfig | null,
  /**
   * Supplied only by callers that have page 1's detail URLs and a browser — i.e.
   * planRun. When absent, api-param is skipped and this behaves exactly as
   * before, so no existing caller changes.
   */
  api?: { browser: IBrowser; page1Urls: string[] },
): Promise<PaginationDetection> {
  if (cached) return { config: cached, source: 'cache' };

  // First rung: the cheapest and the best-verified. No page load beyond one
  // navigation, no AI, and an answer demonstrated rather than inferred.
  let apiParamAttempt: PaginationDetection['apiParamAttempt'];
  if (api && api.page1Urls.length > 0) {
    const { config, ...rest } = await probeApiParam(capture, api.page1Urls, api.browser);
    if (config) return { config, source: 'api-param' };
    // api-param did not apply, and something was eligible to be considered.
    // Carried forward so whichever tier answers instead still reports it —
    // this is what fires the warning in `planRun`, not a `source` value.
    if (rest.considered > 0) apiParamAttempt = rest;
  }
  const withAttempt = (result: PaginationDetection): PaginationDetection =>
    apiParamAttempt ? { ...result, apiParamAttempt } : result;

  const mechanical = detectPaginationFromHtml(capture.html ?? '', capture.url);
  if (mechanical) return withAttempt({ config: mechanical, source: 'mechanical' });

  // The AI sees the screenshot, and pagination is a visual thing — "1 2 3 › Next"
  // at the foot of the page. This fallback existed unused since v1.0.
  if (!agent) return withAttempt({ config: null, source: 'none' });
  try {
    const result = await agent.detectPagination(capture.html ?? '');
    if (!result.has_pagination || result.strategy === 'none') return withAttempt({ config: null, source: 'none' });
    const config: PaginationConfig = {
      strategy: result.strategy,
      ...(result.url_template ? { urlTemplate: result.url_template } : {}),
      ...(result.next_selector ? { nextSelector: result.next_selector } : {}),
      ...(result.page_selector ? { pageSelector: result.page_selector } : {}),
    };
    // A strategy with no way to act on it is not a detection.
    if (!config.urlTemplate && !config.nextSelector && !config.pageSelector) {
      return withAttempt({ config: null, source: 'none' });
    }
    return withAttempt({ config, source: 'ai' });
  } catch {
    // Detection is an optimisation, never a reason to lose the work already planned.
    return withAttempt({ config: null, source: 'none' });
  }
}
