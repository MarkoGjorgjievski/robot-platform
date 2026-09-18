// packages/scraper/src/verify/proof-page-ready.ts
// A proof page captured for MARKING has no expected values to wait for
// (verification-ready.ts waits for those). What it can wait for: the page's
// text to stop growing between two polls, and one structured source (JSON-LD,
// a meta description, or a JSON response) to have landed, since the
// pre-highlights come from those. Bounded by the capture's own 8 s poll
// deadline and settle wait, like every ready check.
import type { ReadyCheck, ReadySnapshot } from '@robot/browser';
import { PAGE_SCRIPT_PRELUDE } from './dom-scripts.js';
import { VERIFY_GRACE_MAX_MS, VERIFY_GRACE_QUIET_MS } from './verification-ready.js';

const TEXT_LENGTH_PROBE = `(() => { ${PAGE_SCRIPT_PRELUDE} return { textLength: (document.body ? document.body.innerText : '').length }; })()`;

export function buildProofPageReadyCheck(_pageUrl: string): ReadyCheck {
  let lastLength = -1;
  let structuredSeen = false;
  return {
    script: TEXT_LENGTH_PROBE,
    when: 'after-expand',
    graceQuietMs: VERIFY_GRACE_QUIET_MS,
    graceMaxMs: VERIFY_GRACE_MAX_MS,
    isReady: (s: ReadySnapshot) => {
      const len = typeof (s.probe as { textLength?: unknown } | null)?.textLength === 'number' ? (s.probe as { textLength: number }).textLength : -1;
      const stable = len >= 0 && len === lastLength;
      lastLength = len;
      if (!structuredSeen) {
        structuredSeen = s.structuredData.ldJson.length > 0
          || typeof s.structuredData.meta['description'] === 'string'
          || typeof s.structuredData.meta['og:title'] === 'string'
          || s.interceptedRequests.some((r) => r.isJson && r.parsedJson !== null);
      }
      return stable && structuredSeen;
    },
  };
}
