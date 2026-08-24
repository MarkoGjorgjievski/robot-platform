// A static HTTP server for multi-page fixtures.
//
// Tier 1's other tests use `setContentEvaluate`, which injects HTML into a blank
// page and never navigates. That makes it structurally incapable of exercising
// `browser.crawl()`'s page-to-page walk: no navigation, no pagination. Serving
// the frozen pages over real HTTP gives the crawler somewhere to actually go,
// for free and offline.
import { createServer } from 'node:http';

export type ServedPage = {
  /** Path INCLUDING any query string, e.g. "/list?page=2" — matched exactly. */
  path: string;
  /** The response body. Named `html` because that is what it is for every HTML fixture. */
  html: string;
  /**
   * Defaults to HTML. Set to `application/json` to serve an API endpoint from the
   * SAME origin as the pages — which is what makes an in-page `fetch` behave like
   * the site's own, cookies and all.
   */
  contentType?: string;
  /**
   * A `Set-Cookie` value to send with this response, e.g. `"sid=abc; Path=/"`.
   *
   * The point is not to simulate auth. It is that a cookie exists ONLY inside
   * the browser context that received it — so a fixture that hands one out on
   * the listing page and demands it back on the API can tell a real in-page
   * fetch apart from a Node-side `fetch()` to the same loopback address, which
   * the request log alone cannot.
   */
  setCookie?: string;
  /**
   * When set, a request whose `Cookie` header does not contain this exact
   * `name=value` pair is refused: `deniedStatus` with `deniedBody`, and the
   * page's real body withheld.
   */
  requireCookie?: string;
  /** Status for a refused request. Default 403. */
  deniedStatus?: number;
  /** Body for a refused request. Default `""`. */
  deniedBody?: string;
  /**
   * Answer cross-origin requests with credentialed CORS headers.
   *
   * Needed to serve an API from a SECOND loopback port. Two ports on 127.0.0.1
   * are different ORIGINS (so CORS applies) but the same SITE for cookie
   * purposes (cookies ignore the port), which is precisely the configuration
   * that isolates `credentials`: only `'include'` attaches the cookie to a
   * cross-origin fetch, so `'same-origin'` and `'omit'` are refused by the
   * cookie gate while a same-origin fixture cannot tell the three apart.
   *
   * The allowed origin is ECHOED rather than `*`, because a browser rejects a
   * credentialed response carrying the wildcard.
   */
  cors?: boolean;
};

export type ServedSite = {
  /** Origin to build URLs from, e.g. "http://127.0.0.1:54321". */
  baseUrl: string;
  /** Every path requested, in order. Mutable so a test can reset it between walks. */
  requests: string[];
  /**
   * The headers of every request, index-aligned with `requests`. Recorded so a
   * test can assert on what the CLIENT sent — a request log of paths says who
   * was asked, never who did the asking or with what.
   */
  requestHeaders: Array<Record<string, string | string[] | undefined>>;
  close: () => Promise<void>;
};

/** The `name=value` pairs in a Cookie header, trimmed. */
function cookiePairs(header: string | undefined): string[] {
  return (header ?? ``).split(`;`).map((c) => c.trim()).filter((c) => c !== ``);
}

export async function serveFixturePages(pages: ServedPage[]): Promise<ServedSite> {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const requests: string[] = [];
  const requestHeaders: Array<Record<string, string | string[] | undefined>> = [];

  const server = createServer((req, res) => {
    const path = req.url ?? '/';
    requests.push(path);
    requestHeaders.push({ ...req.headers });
    const page = byPath.get(path);
    if (page === undefined) {
      // A 404 rather than a fallback page: Playwright's page.goto() does not
      // throw on a 4xx and navigateToPage() never inspects the response
      // status, so this isn't loud in the way an error would be — it's just
      // absorbed as an ordinary "0 items extracted" page, which is exactly
      // what stops a walk that runs past the end of the fixture set. A
      // fallback page that echoed real content back would hide that instead.
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no such fixture page');
      return;
    }
    const cors: Record<string, string> = page.cors
      ? {
        'access-control-allow-origin': (req.headers.origin as string | undefined) ?? '*',
        'access-control-allow-credentials': 'true',
        vary: 'origin',
      }
      : {};
    if (page.requireCookie !== undefined && !cookiePairs(req.headers.cookie).includes(page.requireCookie)) {
      // The denial carries the CORS headers too. Without them the browser hides
      // the 401 behind an opaque network error, and the test would be asserting
      // on a CORS misconfiguration instead of on the cookie gate.
      res.writeHead(page.deniedStatus ?? 403, { 'content-type': page.contentType ?? 'text/plain', ...cors });
      res.end(page.deniedBody ?? '');
      return;
    }
    const headers: Record<string, string> = {
      'content-type': page.contentType ?? 'text/html; charset=utf-8',
      ...cors,
    };
    if (page.setCookie !== undefined) headers['set-cookie'] = page.setCookie;
    res.writeHead(200, headers);
    res.end(page.html);
  });

  // Port 0: the OS hands us a free ephemeral port. A fixed port turns "something
  // else is listening" into a confusing suite failure.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      // listen() succeeded — an error now belongs to some later request, not
      // to startup, so stop treating it as a reason to reject this promise.
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    requestHeaders,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

/** One product card. `data-row` is the hook the extraction xpath and the stamp both use. */
const card = (href: string) => `<div data-row class="item"><a href="${href}">x</a></div>`;

/**
 * A listing that appends its next batch when scrolled near the bottom.
 *
 * Batches after the first live in a JS array rather than the markup, deliberately:
 * if they were in the initial HTML, a crawler that never scrolled would still
 * extract them and every Tier 1 assertion here would pass against a broken loop.
 *
 * `recycle` additionally removes cards scrolled past, reproducing a virtualized
 * list — the case where labels vanish with their nodes and the URL dedupe has to
 * carry correctness on its own.
 */
export function scrollFixturePage(
  opts: { batches: string[][]; recycle?: boolean; endless?: boolean },
): string {
  const [first = [], ...rest] = opts.batches;
  // Interpolated at template-build time, not as a runtime `if (recycle)` guard:
  // a runtime guard's body is JS source text present in the output HTML
  // regardless of which way the condition evaluates, so the recycle statement
  // would show up in every page's markup — including a non-recycling one — and
  // the test that asserts its ABSENCE there would be unable to fail. Only
  // interpolating the line in when `opts.recycle` is set keeps the statement
  // (and thus the behavior it names) truly conditional in the source.
  const recycleLine = opts.recycle ? `/* RECYCLE */ results.innerHTML = '';` : '';
  return `<!doctype html><html><body>
<div id="results">${first.map(card).join('')}</div>
<div style="height:2000px"></div>
<script>
  const rest = ${JSON.stringify(rest)};
  const endless = ${opts.endless ? 'true' : 'false'};
  const results = document.getElementById('results');
  let served = 0;
  let lastServed = 0;
  addEventListener('scroll', () => {
    if (window.scrollY + window.innerHeight < document.body.scrollHeight - 50) return;
    // One batch per 300ms. A single scrollTo(0, scrollHeight) fires 'scroll'
    // repeatedly as the page grows beneath a bottom-pinned viewport — measured
    // in real Chromium: three events, three batches, from ONE call. Without this
    // throttle the fixture hands over the whole listing in one round and any
    // per-round assertion passes or fails for the wrong reason. A real listing
    // has network latency between batches; this is that, made deterministic.
    if (Date.now() - lastServed < 300) return;
    lastServed = Date.now();
    // Endless: a fresh card every round, forever. The only thing that can stop
    // a walk here is MAX_SCROLL_ROUNDS.
    if (endless) {
      const d = document.createElement('div');
      d.setAttribute('data-row', '');
      d.className = 'item';
      d.innerHTML = '<a href="/p/9' + String(served++).padStart(5, '0') + '">x</a>';
      results.appendChild(d);
      return;
    }
    if (served >= rest.length) return;
    const batch = rest[served++];
    ${recycleLine}
    for (const href of batch) {
      const d = document.createElement('div');
      d.setAttribute('data-row', '');
      d.className = 'item';
      d.innerHTML = '<a href="' + href + '">x</a>';
      results.appendChild(d);
    }
  });
</script></body></html>`;
}

/** The same listing, advanced by a button instead of a scroll. The button removes itself when spent. */
export function loadMoreFixturePage(opts: { batches: string[][] }): string {
  const [first = [], ...rest] = opts.batches;
  return `<!doctype html><html><body>
<div id="results">${first.map(card).join('')}</div>
<button id="more">Load more</button>
<script>
  const rest = ${JSON.stringify(rest)};
  const results = document.getElementById('results');
  const btn = document.getElementById('more');
  let served = 0;
  btn.addEventListener('click', () => {
    const batch = rest[served++] || [];
    for (const href of batch) {
      const d = document.createElement('div');
      d.setAttribute('data-row', '');
      d.className = 'item';
      d.innerHTML = '<a href="' + href + '">x</a>';
      results.appendChild(d);
    }
    if (served >= rest.length) btn.remove();
  });
</script></body></html>`;
}
