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
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * Spec 10: one screenshot per screen state, captured by the smoke run into
 * `docs/testing/screens/` for hand review — never asserted on, because a
 * screenshot cannot say whether a page is right, only show it to someone who
 * can. The test runs from `packages/dashboard`, so the directory is resolved
 * from this file rather than from the working directory.
 */
const SCREENS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/testing/screens');

/** `/` -> `index`; `/projects/scratch/output` -> `projects-scratch-output`. */
function screenSlug(route: string): string {
  const slug = route.replaceAll('/', '-').replace(/^-/, '');
  return slug === '' ? 'index' : slug;
}

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

/** Projects this run created (M11), deleted in afterAll alongside sources. */
const createdProjects: string[] = [];

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
  for (const projectId of createdProjects.splice(0)) {
    await client.projects.delete.mutate({ projectId }).catch((err) => console.error(`[smoke] could not delete project ${projectId}:`, err));
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
    if (ENABLED) {
      // Taken in `finally` so a route that failed its checks is still on film,
      // and swallowed so a capture problem can never mask the real failure.
      mkdirSync(SCREENS, { recursive: true });
      await page
        .screenshot({ path: path.join(SCREENS, `${screenSlug(route)}.png`), fullPage: true })
        .catch((err) => console.error(`[smoke] could not screenshot ${route}:`, err));
    }
    await page.close();
  }
}

describe.skipIf(!ENABLED)('dashboard routes render', () => {
  for (const route of ROUTES) {
    it(`${route} renders without throwing`, async () => {
      await checkRoute(route);
    }, 60_000);
  }

  // Legacy paths must land on their new home, not render the old tree or a 404.
  it('redirects /p/scratch/sources to /projects/scratch/sources', async () => {
    const page: Page = await browser.newPage();
    try {
      await page.goto(DASHBOARD + '/p/scratch/sources', { waitUntil: 'networkidle', timeout: 30_000 });
      expect(new URL(page.url()).pathname).toBe('/projects/scratch/sources');
    } finally {
      await page.close();
    }
  });

  // The create flow: a named project, a named website in it, and the
  // website's Schema tab (the index route) rendering its page headers (each
  // with an edit pencil), the contract grid, and the status strip. Phase 3
  // made the field/type columns read-only text rather than disabled inputs
  // ("the table is the page"), so this no longer probes for a placeholder or
  // a disabled `<input>` on the contract row — it checks for the field name
  // as text and the absence of any input carrying its value instead.
  it('a project and a website created through the new procedures render', async () => {
    const project = await client.projects.create.mutate({ name: `Smoke ${Date.now()}` });
    createdProjects.push(project.id);
    await client.datasets.addField.mutate({ datasetId: project.datasetId, name: 'price', type: 'money' });
    const site = await client.sources.createInProject.mutate({ projectSlug: project.slug, name: 'Smoke site', url: 'https://smoke.example/' });
    created.push(site.sourceId);

    await checkRoute(`/projects/${project.slug}`);
    const route = `/projects/${project.slug}/sources/${site.sourceSlug}`;
    await checkRoute(route);
    // The Extract tab on a website whose schema has never been verified: the
    // locked path, which is the one that renders with the most null data.
    await checkRoute(`${route}/extract`);

    const extractPage: Page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await extractPage.goto(DASHBOARD + `${route}/extract`, { waitUntil: 'networkidle', timeout: 30_000 });
      await extractPage.waitForTimeout(1500);
      expect(await extractPage.getByText('Extraction is locked').count(), 'the locked strip is missing').toBeGreaterThan(0);
      // Phase 5: the step heading is a mono number badge followed by the title (no middle dot), so match the heading by its id.
      for (const [n, title] of [[1, 'Pages'], [2, 'Sample'], [3, 'Run']] as const) {
        expect(await extractPage.locator(`#extract-step-${n}`).getByText(title).count(), `${title} is missing`).toBeGreaterThan(0);
      }
    } finally {
      await extractPage.close();
    }

    const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(DASHBOARD + route, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(1500);
      for (let i = 1; i <= 3; i++) {
        expect(await page.getByLabel(`Edit page ${i}`).count(), `page ${i} header has no pencil`).toBeGreaterThan(0);
      }
      expect(await page.getByText('Where it is on this website').count(), 'the grid did not render').toBeGreaterThan(0);
      expect(await page.getByText('Smoke site').count(), 'the website name is not in the header').toBeGreaterThan(0);
      expect(await page.locator('input[value="price"]').count(), 'the field name must not be an input').toBe(0);
      expect(await page.getByText('price', { exact: true }).count(), 'the contract row is missing').toBeGreaterThan(0);
      expect(await page.getByRole('status').count(), 'the status strip is missing').toBeGreaterThan(0);
    } finally {
      await page.close();
    }

    // Overview is retired: its path is a redirect to Extract now, in the
    // router and in the legacy `/p/...` table alike.
    for (const from of [`${route}/overview`, `/p/${project.slug}/sources/${site.sourceSlug}/overview`]) {
      const overview: Page = await browser.newPage();
      try {
        await overview.goto(DASHBOARD + from, { waitUntil: 'networkidle', timeout: 30_000 });
        expect(new URL(overview.url()).pathname, `${from} did not land on Extract`).toBe(`${route}/extract`);
      } finally {
        await overview.close();
      }
    }
  }, 90_000);
});
