// How the finder ("Find products", `sources.checkListingPage`) and the coverage check read a
// listing page (spec 2026-10-20): one capture, no network interception, one screenshot tile; with
// `load`, the capture first loads more of the page (§3.7: at most 3 rounds, stopping at 60
// products or 2 rounds that added none); then the page's links are read in the live page
// (`LISTING_LINKS_SCRIPT`, as the capture's `annotate`). The walk reads the same harvest from its
// own capture. No AI, nothing saved.
import type { IBrowser, PageCapture } from '@robot/browser';
import { asListingLinks, findProductGroup, LISTING_LINKS_SCRIPT, type ListingLinks } from './product-link-group.js';

/** Spec §3.7: rounds of loading the finder asks for (the browser never runs more than 3). */
export const LISTING_LOAD_ROUNDS = 3;
/** Spec §3.7: stop loading once the page holds this many products. */
export const LISTING_LOAD_ENOUGH = 60;

/**
 * Throws what `capture` throws (a `CaptureError` when no document arrived). `links` is empty
 * unless the verdict is ok: a wall's links are not the shop's.
 */
export async function readListingPage(
  browser: IBrowser,
  url: string,
  opts: { load?: boolean; timeout?: number } = {},
): Promise<{ capture: PageCapture; links: ListingLinks }> {
  const capture = await browser.capture(url, {
    waitUntil: 'networkidle',
    interceptNetworkRequests: false,
    maxTiles: 1,
    annotate: LISTING_LINKS_SCRIPT,
    ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
    ...(opts.load
      ? {
        loadMore: {
          rounds: LISTING_LOAD_ROUNDS,
          enough: LISTING_LOAD_ENOUGH,
          probe: LISTING_LINKS_SCRIPT,
          count: (value: unknown) => findProductGroup(asListingLinks(value), url)?.urls.length ?? 0,
        },
      }
      : {}),
  });
  return { capture, links: capture.verdict.kind === 'ok' ? asListingLinks(capture.annotation) : { anchors: [], itemList: [] } };
}
