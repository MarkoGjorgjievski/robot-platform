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
import { chromium, type Browser, type Page } from 'playwright';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@robot/api/routers';

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
  '/projects/scratch',
  '/projects/scratch/output',
  '/projects/scratch/domains',
  '/projects/scratch/sources',
  '/ops/domains',
  // Requires at least one extraction to have run.
  '/ops/domains/www.newegg.com',
  // Legacy paths must redirect, not 404 (spec 3.1).
  '/p/scratch',
  '/p/scratch/sources',
  '/domains',
];

/** Console noise that is not a rendering failure. */
const IGNORABLE = [/favicon/i, /Download the React DevTools/i];

let browser: Browser;

const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${API}/trpc`, transformer: superjson })],
});

/**
 * Sources this run created, deleted in afterAll (M11). A smoke run that
 * leaves Sources behind pollutes the Scratch project a little more every
 * time it is run, and those Sources then show up in the very listings the
 * next run asserts on.
 */
const created: string[] = [];

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

afterAll(async () => {
  await browser?.close();
  for (const sourceId of created.splice(0)) {
    // Best-effort: a cleanup failure must not fail an otherwise green smoke run.
    await client.sources.delete.mutate({ sourceId }).catch((err) => {
      console.error(`[smoke] could not delete source ${sourceId}:`, err);
    });
  }
});

/** Shared "did it render" assertion — same checks the static ROUTES loop and the dynamic Scratch-source test both need. */
async function checkRoute(route: string) {
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
}

describe.skipIf(!ENABLED)('dashboard routes render', () => {
  for (const route of ROUTES) {
    it(`${route} renders without throwing`, async () => {
      await checkRoute(route);
    }, 60_000);
  }

  // The Schema screen (Task 15) replaces Set-up at `/p/$project/sources/$source/setup`.
  // Unlike the static routes above, there's no seeded Scratch source to point at, so this
  // creates one via `sources.createWithSchema` — the same procedure the NewSource wizard
  // calls — then renders its `/setup` route.
  it("a Scratch source's /setup renders without throwing", async () => {
    const host = `smoke-${Date.now()}.example`;
    const { sourceId, projectSlug, sourceSlug } = await client.sources.createWithSchema.mutate({
      urls: [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`],
      fields: [{ name: 'price', type: 'money', description: 'the price near Add to cart' }],
      expected: { price: { [`https://${host}/p/1`]: '$10', [`https://${host}/p/2`]: '$20', [`https://${host}/p/3`]: '$30' } },
    });
    created.push(sourceId);

    await checkRoute(`/p/${projectSlug}/sources/${sourceSlug}/setup`);
  }, 60_000);

  // C2: a Source created any other way — `quickCreate`, or anything
  // predating customer schemas — has no `schemaDefinition` at all, so the
  // Schema tab seeds an empty grid. It must still render the URL inputs and
  // the grid (that is the only screen where those URLs can be filled in),
  // not an error banner.
  it("a quickCreate'd source's /setup renders the URL inputs and the grid", async () => {
    const host = `smoke-quick-${Date.now()}.example`;
    const { sourceId, projectSlug, sourceSlug } = await client.sources.quickCreate.mutate({
      mode: 'detail',
      urls: [`https://${host}/p/1`],
    });
    created.push(sourceId);

    const route = `/p/${projectSlug}/sources/${sourceSlug}/setup`;
    await checkRoute(route);

    const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(DASHBOARD + route, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(1500);
      // The three product URL inputs the Schema tab now owns...
      for (let i = 1; i <= 3; i++) {
        expect(await page.getByText(`Product URL ${i}`).count(), `Product URL ${i} label is missing`).toBeGreaterThan(0);
      }
      // ...and the (empty) grid underneath them.
      expect(await page.getByPlaceholder('price').count(), 'the schema grid did not render').toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 60_000);
});
