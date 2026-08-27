// Does every route actually render?
//
// The dashboard had no tests at all — `vitest --passWithNoTests` — despite being
// the customer-facing surface and the only consumer of most tRPC procedures. The
// failure mode that matters here is not a subtle logic bug, it is a route that
// throws on load: a renamed procedure, a field that is suddenly null, a router
// path that no longer resolves. Component unit tests would not catch any of those.
//
// So this drives the real app in a real browser against the real API and asserts
// the two things that make a page usable: it did not throw, and it rendered
// something other than an error banner.
//
// Needs both servers up, so it is opt-in:
//   pnpm dev:all          (in another terminal)
//   pnpm test:ui

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';

const ENABLED = process.env.RUN_UI_SMOKE === '1';
const DASHBOARD = process.env.DASHBOARD_URL ?? 'http://localhost:3456';
const API = process.env.API_URL ?? 'http://localhost:4000';

/**
 * Routes with their parameters filled from data the seed guarantees:
 * `pnpm db:seed` creates the Scratch project, and any extraction creates a
 * domain row. Param routes are included deliberately — they are where a broken
 * loader or a null field actually shows up.
 */
const ROUTES = [
  '/',
  '/projects',
  '/domains',
  '/p/scratch',
  '/p/scratch/datasets',
  '/p/scratch/inputs',
  '/p/scratch/domains',
  '/p/scratch/sources',
  // Requires at least one extraction to have run. Worth including: it is the
  // busiest read-only view and the only one rendering cache internals.
  '/domains/www.newegg.com',
];

/** Console noise that is not a rendering failure. */
const IGNORABLE = [/favicon/i, /Download the React DevTools/i];

let browser: Browser;

beforeAll(async () => {
  if (!ENABLED) return;
  for (const [label, url] of [['dashboard', DASHBOARD], ['api-server', API + '/healthz']] as const) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) {
      throw new Error(
        `${label} is not responding at ${url}. Start both with \`pnpm dev:all\` before running \`pnpm test:ui\`.`,
      );
    }
  }
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => { await browser?.close(); });

describe.skipIf(!ENABLED)('dashboard routes render', () => {
  for (const route of ROUTES) {
    it(`${route} renders without throwing`, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const problems: string[] = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        if (IGNORABLE.some((re) => re.test(text))) return;
        problems.push(`console: ${text}`);
      });

      try {
        const response = await page.goto(DASHBOARD + route, { waitUntil: 'networkidle', timeout: 30_000 });
        expect(response?.ok(), `${route} returned HTTP ${response?.status()}`).toBe(true);

        // Queries resolve after first paint; give them a moment to fail if they will.
        await page.waitForTimeout(1500);

        const body = (await page.locator('body').innerText()).trim();
        expect(body.length, `${route} rendered an empty page`).toBeGreaterThan(20);

        // The app's own error surface — a route that loads but reports failure is
        // still broken, and would otherwise pass a "did it render" check.
        const banner = await page.getByText(/something went wrong|failed to fetch/i).count();
        expect(banner, `${route} rendered an error banner`).toBe(0);

        expect(problems, `${route} logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60_000);
  }
});
