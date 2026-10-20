export const VERIFY_URL_MIN = 3;
export const VERIFY_URL_MAX = 6;
export const MAX_CERTIFIED_PATHS = 5;
/**
 * Spec 2026-10-20 one-source §3: a one-layout field keeps at most this many certified paths from any one
 * source (confirmed paths excepted). The page's HTML (XPath paths) is exempt by controller ruling
 * (2026-10-20): XPath backups keep today's places, capped only by MAX_CERTIFIED_PATHS.
 */
export const MAX_PATHS_PER_SOURCE = 2;
export const CAPTURE_REUSE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * Spec 2026-10-17 §8: one AI call reads every checked proof page's capture, so its cost grows with
 * the pages. Campaign 2 calls cost $0.08–$0.17 (skims: $0.1521 for one field on three pages), so
 * $0.06 a page keeps "up to" an upper bound.
 */
export const EST_AI_COST_PER_FIELD_PAGE_USD = 0.06;

/** The most one AI-reachable field may cost at Verify on this many proof pages (never fewer than three). */
export function estAiCostPerFieldUsd(pages: number): number {
  return Math.round(EST_AI_COST_PER_FIELD_PAGE_USD * Math.max(pages, VERIFY_URL_MIN) * 100) / 100;
}
export const DRIFT_MISS_SHARE = 0.2;
export const DRIFT_MIN_ROWS = 5;
export const FIND_PRODUCT_PAGES_LIMIT = 10;
/** An in-flight verification older than this is a crash leftover, not work in progress. */
export const VERIFY_STALL_MS = 15 * 60 * 1000;
export const PROOF_PAGE_MAX_TILES = 6; // 9,216 px: a product page's specs and reviews usually sit below the AI-cost cap of three
