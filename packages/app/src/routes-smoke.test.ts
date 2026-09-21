// Does the shell actually work in a browser, in both themes?
//
// The same bet as `@robot/dashboard`'s smoke (`packages/dashboard/src/routes-smoke.test.ts`):
// the failure that matters in a route tree is not a subtle logic bug, it is a
// screen that throws on load — a renamed procedure, a null field, a loader that
// redirects in a loop. Unit tests on `src/lib/*-view.ts` cannot see any of that.
//
// What is different here is identity and theme. Every screen behind `/_app`
// exists only for a signed-in user, so this walk signs in the way a customer
// does — the `/login` form in a real browser, never a scripted call — as a
// throwaway `smoke-<timestamp>@example.com`, and it walks the five routes twice,
// once per theme, flipping the theme through the user menu in between. The
// screenshots it leaves in `docs/testing/screens/` are the set Marko reviews.
//
// Needs the api-server and the app up, so it is opt-in:
//   pnpm dev:all          (in another terminal)
//   pnpm test:ui:app
//
// The throwaway user and its personal org are left behind deliberately: this
// run has no right to delete an org, and a user row costs nothing. The project
// it creates it does delete, over tRPC with its own session cookie.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppRouter } from '@robot/api/routers';

const ENABLED = process.env.RUN_UI_SMOKE === '1';
const APP = process.env.APP_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';

/** Every screen of plan 1. Each is a route a signed-in customer can reach from the sidebar. */
const ROUTES = ['/projects', '/runs', '/usage', '/settings', '/account'] as const;

const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];

/** Console noise that is not a rendering failure. */
const IGNORABLE = [/favicon/i, /Download the React DevTools/i];

/** Spec §8: a screenshot per route per theme, for hand review — never asserted on. */
const SCREENS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/testing/screens');

/**
 * `animations: 'disabled'` is not cosmetic here. The page-load `.rise` is
 * `opacity: 0` with `animation-fill-mode: both`, and a headless browser only
 * starts a CSS animation on its first rendered frame — which the screenshot
 * itself provokes. Capturing straight after a navigation therefore photographs
 * the animation's *from* keyframe: a completely empty page. Disabling
 * fast-forwards finite animations to their end and freezes the pulsing dot,
 * which also makes every capture byte-stable.
 */
const shoot = (p: Page, file: string) =>
  p.screenshot({ path: path.join(SCREENS, file), fullPage: true, animations: 'disabled' });

/** `/projects` -> `projects`. */
const screenSlug = (route: string) => route.replace(/^\//, '').replaceAll('/', '-');

const EMAIL = `smoke-${Date.now()}@example.com`;

let browser: Browser;
let context: BrowserContext;
let page: Page;
/** The project this run creates through the dialog; deleted in `afterAll`. */
let projectId: string | null = null;

/**
 * A tRPC client carrying this run's session cookie, so the cleanup deletes the
 * throwaway project from the *throwaway* org. Without the cookie `projects.delete`
 * falls back to the `orgSlug ?? 'default'` shim and would be asking about the
 * seeded org instead — which is not where this project lives.
 */
function apiAs(cookie: string) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${API}/trpc`, transformer: superjson, headers: () => ({ cookie }) })],
  });
}

async function sessionCookie(ctx: BrowserContext): Promise<string> {
  const cookies = await ctx.cookies(API);
  const session = cookies.find((c) => c.name === 'robot_session');
  if (!session) throw new Error('no robot_session cookie — the sign-in did not take');
  return `${session.name}=${session.value}`;
}

/** Console and page errors seen on `page` since the last `problems.length = 0`. */
const problems: string[] = [];

function watch(p: Page) {
  p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (IGNORABLE.some((re) => re.test(text))) return;
    problems.push(`console: ${text}`);
  });
}

/**
 * Wait for React to have hydrated the form before typing into it.
 *
 * Filling a server-rendered input before hydration writes the DOM value and
 * nothing else — no listener is attached yet, so React's state stays empty and
 * the form posts two empty strings. React tags every hydrated host node with a
 * `__reactProps$…` key, which is the cheapest honest signal that the listener
 * is there.
 */
async function waitForHydration(p: Page, selector: string) {
  await p.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps$'));
    },
    selector,
    { timeout: 20_000 },
  );
}

/** The customer's own way in: the login form, filled and submitted. */
async function signInThroughTheForm(p: Page, email: string) {
  await p.goto(`${APP}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
  await waitForHydration(p, '#email');
  await p.locator('#email').fill(email);
  await p.locator('#password').fill('smoke');
  expect(await p.locator('#email').inputValue(), 'the email field did not take the value').toBe(email);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL(`${APP}/projects`, { timeout: 30_000 });
}

/**
 * Flip the theme the way a customer does — user menu, Theme, the radio item —
 * and do not return until the *server* agrees.
 *
 * The click flips `data-theme` on the element first and sends `auth.setTheme`
 * after, so the attribute is true a beat before the user row is. Every screen
 * below is a fresh document whose `data-theme` the server renders from that
 * row, so a walk that started on the optimistic flip alone would photograph
 * the previous theme.
 */
async function chooseTheme(p: Page, theme: Theme) {
  await p.locator('aside button').filter({ hasText: EMAIL }).first().click();
  await p.getByRole('menuitem', { name: 'Theme' }).click();
  const saved = p.waitForResponse((r) => r.url().includes('auth.setTheme'), { timeout: 15_000 }).catch(() => null);
  await p.getByRole('menuitemradio', { name: theme === 'dark' ? 'Dark' : 'Light' }).click();
  await saved;
  await p.keyboard.press('Escape');
  await expect
    .poll(
      async () => {
        await p.reload({ waitUntil: 'networkidle' });
        return p.evaluate(() => document.documentElement.dataset.theme);
      },
      { timeout: 30_000, interval: 500 },
    )
    .toBe(theme);
}

beforeAll(async () => {
  if (!ENABLED) return;
  for (const [label, url] of [['app', APP], ['api-server', `${API}/healthz`]] as const) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) {
      throw new Error(`${label} is not responding at ${url}. Start everything with \`pnpm dev:all\` before \`pnpm test:ui:app\`.`);
    }
  }
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  watch(page);
  mkdirSync(SCREENS, { recursive: true });

  // Signed out first: `/login` is the one screen a visitor sees before any
  // preference of theirs exists, so it is captured before the sign-in.
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
  await shoot(page, 'app-login.png');

  await signInThroughTheForm(page, EMAIL);
}, 120_000);

afterAll(async () => {
  if (!ENABLED) return;
  if (projectId) {
    const cookie = await sessionCookie(context).catch(() => null);
    if (cookie) {
      // Best effort: a cleanup failure must not fail an otherwise green run.
      await apiAs(cookie)
        .projects.delete.mutate({ projectId })
        .catch((err) => console.error('[smoke] could not delete the throwaway project:', err));
    }
  }
  await browser?.close();
});

describe.skipIf(!ENABLED)('app shell', () => {
  for (const theme of THEMES) {
    it(`every screen renders in the ${theme} theme`, async () => {
      await page.goto(`${APP}/projects`, { waitUntil: 'networkidle', timeout: 30_000 });
      await waitForHydration(page, 'aside');
      await chooseTheme(page, theme);

      for (const route of ROUTES) {
        problems.length = 0;
        const response = await page.goto(APP + route, { waitUntil: 'networkidle', timeout: 30_000 });
        expect(response?.ok(), `${route} returned HTTP ${response?.status()}`).toBe(true);
        expect(new URL(page.url()).pathname, `${route} did not stay put`).toBe(route);

        // Queries resolve after first paint; give them a moment to fail if they will.
        await page.waitForTimeout(1200);

        expect(await page.evaluate(() => document.documentElement.dataset.theme), `${route} is not in the ${theme} theme`).toBe(theme);
        expect(await page.locator('h1').count(), `${route} has no page title`).toBeGreaterThan(0);
        expect(await page.locator('aside nav a').count(), `${route} has no sidebar nav`).toBe(4);
        const body = (await page.locator('body').innerText()).trim();
        expect(body.length, `${route} rendered an empty page`).toBeGreaterThan(20);
        expect(problems, `${route} logged errors in ${theme}:\n  ${problems.join('\n  ')}`).toEqual([]);

        await shoot(page, `app-${screenSlug(route)}-${theme}.png`);
      }
    }, 180_000);
  }

  it('a project created through the dialog appears in the table', async () => {
    const name = `Smoke ${Date.now()}`;
    problems.length = 0;
    await page.goto(`${APP}/projects`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');

    // From the empty state or from the header — whichever "New project" is on
    // screen; the page deliberately never shows both.
    await page.getByRole('button', { name: 'New project' }).first().click();
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create project' }).click();

    await page.getByRole('cell', { name, exact: true }).waitFor({ timeout: 20_000 });
    expect(problems, `creating a project logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);

    // The id for the cleanup, read back through the same session that made it.
    const rows = await apiAs(await sessionCookie(context)).projects.list.query();
    projectId = rows.find((r) => r.name === name)?.id ?? null;
    expect(projectId, 'the new project is not in projects.list').not.toBeNull();
  }, 120_000);

  it('signing out closes the door: /projects goes back to /login', async () => {
    // Its own context, so the cookie this run cleans up with stays alive:
    // `auth.signOut` deletes the one session it was called with, and `afterAll`
    // still has a project to delete.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    try {
      await signInThroughTheForm(p, EMAIL);
      await waitForHydration(p, 'aside');
      await p.locator('aside button').filter({ hasText: EMAIL }).first().click();
      await p.getByRole('menuitem', { name: 'Sign out' }).click();
      await p.waitForURL(`${APP}/login`, { timeout: 30_000 });

      await p.goto(`${APP}/projects`, { waitUntil: 'networkidle', timeout: 30_000 });
      expect(new URL(p.url()).pathname, 'a signed-out visitor reached /projects').toBe('/login');
    } finally {
      await ctx.close();
    }
  }, 120_000);
});
