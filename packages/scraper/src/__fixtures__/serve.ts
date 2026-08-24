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
};

export type ServedSite = {
  /** Origin to build URLs from, e.g. "http://127.0.0.1:54321". */
  baseUrl: string;
  /** Every path requested, in order. Mutable so a test can reset it between walks. */
  requests: string[];
  close: () => Promise<void>;
};

export async function serveFixturePages(pages: ServedPage[]): Promise<ServedSite> {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const requests: string[] = [];

  const server = createServer((req, res) => {
    const path = req.url ?? '/';
    requests.push(path);
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
    res.writeHead(200, { 'content-type': page.contentType ?? 'text/html; charset=utf-8' });
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
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}
