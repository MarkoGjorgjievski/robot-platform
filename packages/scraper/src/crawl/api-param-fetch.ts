// The page fetches; Node decides.
//
// Every judgement about which parameter pages this endpoint lives in
// `api-param-candidates.ts` as a pure function, because logic that only exists
// inside a stringified in-page script cannot be unit-tested — and the
// verification is the part of this design most in need of tests. This file does
// the one thing that genuinely has to happen in the browser: issuing the fetches
// from the site's own origin, with its cookies.

import type { IBrowser } from '@robot/browser';

export type FetchedBody = {
  url: string;
  status: number;
  json: unknown | null;
  error: string | null;
};

/**
 * A script that fetches every URL and returns one record each.
 *
 * Defensive by construction: a non-2xx, a body that is not JSON, and a network
 * error all become a record with `error` set, never a throw. One bad URL must not
 * cost the batch.
 */
export function buildFetchScript(urls: string[]): string {
  return `(async () => {
  const urls = ${JSON.stringify(urls)};
  const out = [];
  for (const url of urls) {
    try {
      // credentials: 'include' is the reason this runs in the page rather than
      // in Node — session cookies and auth headers apply automatically.
      const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { json = null; }
      out.push({ url, status: res.status, json, error: json === null ? 'not json' : null });
    } catch (e) {
      out.push({ url, status: 0, json: null, error: String((e && e.message) || e) });
    }
  }
  return out;
})()`;
}

/**
 * Fetch a batch of URLs from `pageUrl`'s context. One navigation for the batch.
 *
 * Answers `[]` rather than throwing on any page-level failure: pagination is an
 * optimisation layered on top of work that is already planned, and spec §3 is
 * explicit that a pagination failure must never lose page 1's items.
 */
export async function fetchInPage(
  browser: IBrowser,
  pageUrl: string,
  urls: string[],
): Promise<FetchedBody[]> {
  if (urls.length === 0) return [];
  try {
    return await browser.evaluate<FetchedBody[]>(pageUrl, buildFetchScript(urls));
  } catch {
    return [];
  }
}
