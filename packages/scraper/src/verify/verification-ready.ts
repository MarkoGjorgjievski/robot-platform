// packages/scraper/src/verify/verification-ready.ts
// A proof-page capture waits for the customer's expected values, not for the
// page to go quiet.
//
// Verification used to capture with `networkidle`, which a site that holds a
// connection open never reaches: Ikea paid the full 60 s timeout on every
// proof page (four pages, 346 s, 2026-09-17). A certified run knows its paths
// and waits for those (`buildReadyCheck` in verified-extraction.ts).
// Verification has no paths yet, but it knows what it is looking for: the
// values typed on this page. The page is ready once every one of them can be
// found, by the same two searches verification runs on the capture afterwards:
//
// - in the page: `buildDomSearchScript` is already a page script that takes the
//   expected values as needles, so it IS the live probe;
// - in the data: `searchStructured` over the JSON-LD, meta tags and API
//   responses seen so far.
//
// A value that never appears (a typo, a field this page does not carry) costs
// the check's bounded deadline and settle wait, then the capture goes on as it
// always has and the cell fails the way it always did.

import type { ReadyCheck, ReadySnapshot } from '@robot/browser';
import { buildDomSearchScript, type DomHit, type DomNeedle } from './dom-scripts.js';
import { searchStructured } from './search-structured.js';
import type { SchemaDefinitionField } from './types.js';

/**
 * Once every value is found, hold the capture until no new response has
 * arrived for this long. A value can show in the visible page a moment before
 * the API response carrying it lands; capturing in that gap would certify a
 * page path where an API path, the better one, was available, and could differ
 * from one proof page to the next.
 */
export const VERIFY_GRACE_QUIET_MS = 750;
export const VERIFY_GRACE_MAX_MS = 3_000;

/**
 * The ready check for one proof page.
 *
 * `expectedOnPage` maps field key → the value typed for THIS page. A blank
 * value means the field is not checked here (pages four to six) and is not
 * waited for. Polled after the popup and "show more" rounds, because
 * verification reads the page as the capture serialises it, and some values
 * only exist in the DOM once those rounds have run.
 */
export function buildVerificationReadyCheck(
  fields: SchemaDefinitionField[],
  expectedOnPage: Record<string, string>,
  pageUrl: string,
): ReadyCheck {
  const needles: DomNeedle[] = fields
    .filter((f) => (expectedOnPage[f.key] ?? '').trim() !== '')
    .map((f) => ({ key: f.key, type: f.type, expected: expectedOnPage[f.key]! }));
  // Remembered across polls: the structured search walks every API body, so a
  // found field is not searched again; and a node that leaves a virtualised
  // list after being seen must not un-ready the page.
  const found = new Set<string>();

  return {
    script: buildDomSearchScript(needles, pageUrl),
    when: 'after-expand',
    graceQuietMs: VERIFY_GRACE_QUIET_MS,
    graceMaxMs: VERIFY_GRACE_MAX_MS,
    isReady: (s: ReadySnapshot) => {
      const hits = Array.isArray(s.probe) ? (s.probe as DomHit[]) : [];
      for (const h of hits) found.add(h.key);
      const data = { url: pageUrl, structuredData: s.structuredData, interceptedRequests: s.interceptedRequests };
      for (const n of needles) {
        if (found.has(n.key)) continue;
        if (searchStructured(data, n.type, n.expected).length > 0) found.add(n.key);
      }
      return needles.every((n) => found.has(n.key));
    },
  };
}
