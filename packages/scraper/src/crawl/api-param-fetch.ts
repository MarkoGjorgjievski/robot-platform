// The page fetches; Node decides.
//
// Every judgement about which parameter pages this endpoint lives in
// `api-param-candidates.ts` as a pure function, because logic that only exists
// inside a stringified in-page script cannot be unit-tested — and the
// verification is the part of this design most in need of tests. This file does
// the one thing that genuinely has to happen in the browser: issuing the fetches
// from the site's own origin, with its cookies. Cookies and HTTP auth only —
// see the note at the fetch call for what `credentials: 'include'` does not
// restore.

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
 *
 * **What `credentials: 'include'` buys, and what it does not.** It attaches the
 * site's session COOKIES — and any HTTP-level Basic/Digest auth — to a fetch the
 * browser would otherwise send bare. That is the reason this runs in the page
 * instead of in Node, and it covers the large majority of sites, which authorise
 * by cookie.
 *
 * It does NOT restore request HEADERS. A JS-set `Authorization: Bearer …` or an
 * `X-CSRF-Token` is written by the site's own JavaScript on every XHR; it lives
 * nowhere the credential store can reach, so a fetch issued from the page carries
 * neither. On a site authorised that way EVERY probe 401s, api-param records
 * `none-verified`, and detection falls through to the HTML strategies. No work is
 * lost — but a 401 here must not be read as "the parameter was wrong". Replaying
 * those headers off the matching `InterceptedRequest` is the fix, and it is
 * deliberately out of scope for this cycle.
 */
export function buildFetchScript(urls: string[]): string {
  return `(async () => {
  const urls = ${JSON.stringify(urls)};
  const out = [];
  for (const url of urls) {
    try {
      // Credentialed on purpose — see this function's doc comment for exactly
      // what that does and does not restore.
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
