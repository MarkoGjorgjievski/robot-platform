// Fix round 1 follow-up: crawl-options.test.ts only proves a hand-written
// FakeBrowser can honour `startPage` — it says nothing about whether the real
// `PlaywrightBrowser.crawl` generator does. That matters because the whole
// point of `startPage` is to skip re-fetching page 1's *data*, not to skip
// navigating to it: the next-button and page-numbers strategies work by
// clicking controls on the page that is currently loaded, so page 1 must
// still be requested even when its yield is suppressed. A fake can't catch a
// future regression that skips the navigation along with the yield — only
// driving the real generator against a real server can.
//
// This test spins up a tiny local HTTP server (ephemeral port) serving two
// pages that paginate via a `?page=N` URL, which the mechanical url-pattern
// detector picks up from page 1's HTML. It records every request path the
// server receives and asserts, against the real `PlaywrightBrowser.crawl`:
//   (a) startPage: 2 still causes page 1 to be requested (navigation happens)
//   (b) startPage: 2 yields only page 2 (page 1's data is not yielded)
//   (c) the default (no startPage) yields both pages — unchanged behaviour

import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PlaywrightBrowser } from './playwright-browser.js';

function page1Html(): string {
  return `<!doctype html><html><body>
    <div class="item">Item 1</div>
    <a href="/?page=2">Next</a>
  </body></html>`;
}

function page2Html(): string {
  return `<!doctype html><html><body>
    <div class="item">Item 2</div>
  </body></html>`;
}

const EXTRACTION_SCRIPT = `
  (() => {
    const items = Array.from(document.querySelectorAll('.item')).map(el => ({ text: el.textContent }));
    return { data: items, totalRows: items.length };
  })()
`;

describe('PlaywrightBrowser.crawl — startPage against a real local server', () => {
  it('still navigates page 1 for click-based strategies, yields only pages >= startPage, and leaves default behaviour unchanged', async () => {
    const requestedPaths: string[] = [];
    const server = http.createServer((req, res) => {
      requestedPaths.push(req.url ?? '');
      const url = new URL(req.url ?? '/', 'http://localhost');
      const html = url.searchParams.get('page') === '2' ? page2Html() : page1Html();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    const startUrl = `http://localhost:${port}/?page=1`;

    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });

    try {
      // --- startPage: 2 ---
      const skippedRunPages: number[] = [];
      for await (const page of browser.crawl(startUrl, {
        extractionScript: EXTRACTION_SCRIPT,
        startPage: 2,
        maxPages: 2,
      })) {
        skippedRunPages.push(page.pageNumber);
      }

      // (a) page 1 was still navigated even though its yield was skipped —
      // this is the assertion that protects the click-based strategies.
      expect(requestedPaths.some(p => p.includes('page=1'))).toBe(true);
      // (b) only page 2 was yielded
      expect(skippedRunPages).toEqual([2]);

      requestedPaths.length = 0;

      // --- default startPage ---
      const defaultRunPages: number[] = [];
      for await (const page of browser.crawl(startUrl, {
        extractionScript: EXTRACTION_SCRIPT,
        maxPages: 2,
      })) {
        defaultRunPages.push(page.pageNumber);
      }

      // (c) default (unspecified) startPage is unchanged — both pages yielded
      expect(defaultRunPages).toEqual([1, 2]);
      expect(requestedPaths.some(p => p.includes('page=1'))).toBe(true);
      expect(requestedPaths.some(p => p.includes('page=2'))).toBe(true);
    } finally {
      await browser.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 60_000);
});
