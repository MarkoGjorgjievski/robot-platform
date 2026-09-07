import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PlaywrightBrowser } from './playwright-browser.js';

describe('setContentEvaluate', () => {
  it('runs an XPath against given HTML offline (no navigation)', async () => {
    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });
    try {
      const html = '<html><body><div id="probe"><span class="v">hello</span></div></body></html>';
      const script = `
        (() => {
          const r = document.evaluate('//span[@class="v"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return r.singleNodeValue ? r.singleNodeValue.textContent : null;
        })()
      `;
      const result = await browser.setContentEvaluate<string | null>(html, script);
      expect(result).toBe('hello');
    } finally {
      await browser.close();
    }
  }, 30_000);

  // Regression for the 2026-09-07 live pre-check: a real captured page's
  // <script src> pointing at a hanging server (trackers, ad tags, etc. on a
  // real site) blew setContent's default 30s "load" timeout, crashing every
  // live schema verification at the "searching" stage. setContentEvaluate
  // must never let a page's own subresources touch the network at all — a
  // server that accepts the connection and then never responds proves that,
  // since anything short of a hard route-abort would still hang waiting on
  // it.
  describe('never touches the network for a page\'s own subresources', () => {
    let server: Server;
    let port: number;

    beforeAll(async () => {
      server = createServer((_req, _res) => {
        // Deliberately never respond — the connection is accepted and left open.
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    });

    it('resolves quickly even when the HTML references a script from a hanging server', async () => {
      const browser = new PlaywrightBrowser();
      await browser.launch({ headless: true });
      try {
        const html = `<html><head><script src="http://127.0.0.1:${port}/never.js"></script></head><body><div id="x">hello</div></body></html>`;
        const started = Date.now();
        const result = await browser.setContentEvaluate<string | null>(html, 'document.getElementById("x").textContent');
        const elapsedMs = Date.now() - started;

        expect(result).toBe('hello');
        // The hanging request has no deadline of its own; if setContentEvaluate
        // were waiting on it, this would run out the test's 15s timeout instead
        // of resolving quickly. Well under that is proof the network was never
        // in the critical path.
        expect(elapsedMs).toBeLessThan(10_000);
      } finally {
        await browser.close();
      }
    }, 15_000);
  });
});
