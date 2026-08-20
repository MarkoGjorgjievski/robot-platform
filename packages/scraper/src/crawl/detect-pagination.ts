// Deciding HOW a listing paginates, before spending a page load finding out.
//
// Detection used to happen inside `browser.crawl()`, from page 1's HTML — which
// meant crawl() re-navigated to page 1 purely to look at markup the caller had
// already captured. Worse, when a page has NO pagination (most category pages
// with a carousel and nothing else), that wasted load bought nothing.
//
// Doing it here, from the capture, means: no extra fetch, the AI fallback finally
// has a caller, and the resulting config can be cached per domain later.

import type { PageCapture, PaginationConfig } from '@robot/browser';
import { detectPaginationFromHtml } from '@robot/browser';

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
  source: 'cache' | 'mechanical' | 'ai' | 'none';
};

export async function detectPagination(
  capture: PageCapture,
  agent: PaginationAgent | null,
  cached?: PaginationConfig | null,
): Promise<PaginationDetection> {
  if (cached) return { config: cached, source: 'cache' };

  const mechanical = detectPaginationFromHtml(capture.html ?? '', capture.url);
  if (mechanical) return { config: mechanical, source: 'mechanical' };

  // The AI sees the screenshot, and pagination is a visual thing — "1 2 3 › Next"
  // at the foot of the page. This fallback existed unused since v1.0.
  if (!agent) return { config: null, source: 'none' };
  try {
    const result = await agent.detectPagination(capture.html ?? '');
    if (!result.has_pagination || result.strategy === 'none') return { config: null, source: 'none' };
    const config: PaginationConfig = {
      strategy: result.strategy,
      ...(result.url_template ? { urlTemplate: result.url_template } : {}),
      ...(result.next_selector ? { nextSelector: result.next_selector } : {}),
      ...(result.page_selector ? { pageSelector: result.page_selector } : {}),
    };
    // A strategy with no way to act on it is not a detection.
    if (!config.urlTemplate && !config.nextSelector && !config.pageSelector) {
      return { config: null, source: 'none' };
    }
    return { config, source: 'ai' };
  } catch {
    // Detection is an optimisation, never a reason to lose the work already planned.
    return { config: null, source: 'none' };
  }
}
