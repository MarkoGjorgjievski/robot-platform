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
// Plan 2's three screens live inside a project, and a project with nothing in it
// shows three empty states — so the run builds one first: a project through the
// New project dialog, a website through Add website, a field from the catalogue.
// Every one of those is the customer's own gesture in a real browser, which is
// also the only honest way to prove the mutations reach the API.
//
// Plan 3's four screens live inside that website, and plan 5 made its first
// tab the Verification tab — since 2026-09-28 one table, a row per field and
// a column per product. That tab needs real pages, so this run serves its own
// — a `node:http` server on 127.0.0.1 with a listing and the three
// shop-example product pages (with their JSON-LD) — and adds the website on
// that address, so nothing here touches the outside network. It pastes the
// listing, waits for the three screenshots, reads what each row needs (Title
// and Price agree from the page data; nothing names Rating), accepts what
// agrees in one click, opens Rating's screenshot from its cell and marks the
// value there, accepts what that carries to the other two products, and
// reloads to find every cell still accepted. All of that is free: captures,
// suggestions and transfers use no model. It never clicks Verify, Sample,
// Extract or Check: every one of those can spend, and a test that spends
// money is a test nobody runs. So the Verify button is read for its label,
// Extract is photographed locked, Runs empty, and Settings is proven by a
// rename that goes to the server and comes back.
//
// Needs the api-server and the app up, so it is opt-in:
//   pnpm dev:all          (in another terminal)
//   pnpm test:ui:app
//
// The throwaway user and its personal org are left behind deliberately: this
// run has no right to delete an org, and a user row costs nothing. The project
// it creates it does delete, over tRPC with its own session cookie — and that
// delete cascades to the website and the field list under it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppRouter } from '@robot/api/routers';
// By relative path: the shop-example pages are a test helper of `@robot/api`,
// not part of its public surface.
import { SHOP_EXAMPLE } from '../../api/src/test-helpers/shop-example';

const ENABLED = process.env.RUN_UI_SMOKE === '1';
const APP = process.env.APP_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';

/** Every screen of plan 1. Each is a route a signed-in customer can reach from the sidebar. */
const ROUTES = ['/projects', '/runs', '/usage', '/settings', '/account'] as const;

/**
 * The shop this run serves itself (see `serveShop`), on a port the OS picks —
 * so the website's address is only known once `beforeAll` has run. Its
 * products are on the same host, which is what the same-website rule wants.
 */
let shop: Server | null = null;
let SHOP = '';
/** The website's address: the local shop's root. */
const websiteUrl = () => `${SHOP}/`;
const WEBSITE_HOST = '127.0.0.1';
/** What `siteNameFromUrl` derives from `http://127.0.0.1:<port>/` — the dialog's prefill. Not pretty; it is what a customer would see. */
const WEBSITE_NAME = '0';
/** The catalogue chips this run clicks, on the Product tab it opens on: name and the type the chip shows beside it. */
const FIELDS = [
  { name: 'Title', type: 'Text' },
  { name: 'Price', type: 'Money' },
  // Nothing on the shop's pages names a rating in its page data, so this row
  // needs the customer: the one the Verification walk marks on a screenshot.
  { name: 'Rating', type: 'Number' },
] as const;

/** The three products the listing links to, in its order: `SHOP_EXAMPLE`'s pages, their headings, and the values they show. */
const PRODUCTS = [
  { path: '/p/1', page: SHOP_EXAMPLE.p1, title: 'Widget A', price: '$129.99', rating: '4.5' },
  { path: '/p/2', page: SHOP_EXAMPLE.p2, title: 'Widget B', price: '$219.99', rating: '3.8' },
  { path: '/p/3', page: SHOP_EXAMPLE.p3, title: 'Widget C', price: '$149.00', rating: '4.9' },
] as const;

/** A 1×1 transparent PNG: every image the shop serves. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/**
 * The listing: three product cards (a photo and the product's name in a link)
 * and one link that is not a product, which the listing heuristic must leave
 * out. The product pages are `SHOP_EXAMPLE`'s html with its JSON-LD put back
 * where a shop keeps it, in the head — the page data `suggestMarks` reads.
 */
function shopPage(pathname: string): { type: string; body: string | Buffer } | null {
  if (pathname === '/' || pathname === '/about') {
    return { type: 'text/html', body: '<html><head><title>Widget shop</title></head><body><h1>Widget shop</h1></body></html>' };
  }
  if (pathname === '/l') {
    const cards = PRODUCTS.map((p, i) => `<li><a href="${p.path}"><img src="/i/${i + 1}.png" alt=""><span>${p.title}</span></a></li>`).join('');
    return {
      type: 'text/html',
      body: `<html><head><title>All widgets</title></head><body><h1>All widgets</h1><ul class="grid">${cards}</ul><a href="/about">About the shop</a></body></html>`,
    };
  }
  if (/^\/(i|img)\/[\w.-]+$/.test(pathname)) return { type: 'image/png', body: PIXEL };
  const product = PRODUCTS.find((p) => p.path === pathname);
  if (!product) return null;
  const ld = product.page.structuredData.ldJson.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('');
  return { type: 'text/html', body: product.page.html.replace('<html>', `<html><head><title>${product.title}</title>${ld}</head>`) };
}

function serveShop(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const found = shopPage(new URL(req.url ?? '/', 'http://x').pathname);
    if (!found) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': found.type }).end(found.body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

/**
 * Plan 2's three screens, each with the one thing that proves it is the real
 * screen and not an empty shell: the website that was just added, the field that
 * was just picked, and the empty sheet a project with no run has.
 */
const PROJECT_SCREENS = [
  {
    name: 'home',
    route: '',
    assert: async () => {
      expect(
        await page.locator('tbody tr').filter({ hasText: WEBSITE_HOST }).count(),
        'the project home has no row for the website this run added',
      ).toBe(1);
    },
  },
  {
    name: 'fields',
    route: '/fields',
    assert: async () => {
      for (const f of FIELDS) {
        expect(
          await page.getByRole('textbox', { name: `Name of ${f.name}` }).count(),
          `the Fields screen has no row for ${f.name}, which this run added`,
        ).toBe(1);
      }
    },
  },
  {
    name: 'output',
    route: '/output',
    assert: async () => {
      // Nothing has run, and running anything costs money: the empty state is
      // the only honest state this screen can be in here.
      expect(await page.locator('main').innerText(), 'Output is not in its empty state').toContain('No rows yet');
    },
  },
] as const;

/**
 * Plan 3's four website screens, the first of them plan 5's Verification tab.
 * Each carries the one thing that proves it is the real screen: this run's
 * three products with every cell of the table accepted, the locked strip a website that
 * has never verified must show, the empty run list, and the settings rows.
 *
 * Nothing here clicks a control that spends: the Verify button is read for its
 * label and left alone, and Sample / Extract / Check are never reached at all
 * (the Extract tab is inert while nothing is verified, which is the state this
 * run is honestly in).
 */
const SITE_SCREENS = [
  {
    name: 'verification',
    route: '',
    assert: async () => {
      for (const p of PRODUCTS) {
        expect(await page.getByRole('button', { name: new RegExp(p.title) }).count(), `the card for ${p.title} is missing`).toBe(1);
      }
      for (const f of FIELDS) {
        for (let i = 1; i <= 3; i++) {
          expect(await cellState(f.name, i), `${f.name} on product ${i} lost its answer`).toBe('accepted');
        }
      }
      // Read, never pressed — a verification is the one thing on this screen
      // that can cost money.
      expect(await verifyButtonOf(page).count(), 'the Verify button is missing').toBe(1);
    },
  },
  {
    name: 'extract',
    route: '/extract',
    assert: async () => {
      // Nothing has been verified, so this is the tab's true state.
      const main = await page.locator('main').innerText();
      expect(main, 'the Extract tab is not locked on an unverified website').toContain('Extraction is locked');
      expect(main, 'the locked strip offers no way back to the Schema tab').toContain('Go to the Verification tab');
      expect(await page.locator('main [inert]').count(), 'the locked sections are still reachable').toBeGreaterThan(0);
    },
  },
  {
    name: 'runs',
    route: '/runs',
    assert: async () => {
      // A run can only exist if something spent money, and nothing here has.
      expect(await page.locator('main').innerText(), 'Runs is not in its empty state').toContain('No extractions yet');
      expect(await page.locator('main table').count(), 'a table is drawn over no runs').toBe(0);
    },
  },
  {
    name: 'settings',
    route: '/settings',
    assert: async () => {
      expect(
        await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(),
        'the Name row does not hold the website name',
      ).toBe(WEBSITE_NAME);
      expect(await page.getByRole('button', { name: 'Delete website' }).count(), 'the Danger zone has no delete').toBe(1);
    },
  },
] as const;

/**
 * Plan 4's four organisation screens, each with the one thing that proves it
 * is the real screen: the runs empty state (nothing has run, and running
 * costs money), the Usage total at $0.00 with the throwaway's project in the
 * table, the personal organisation's name in the Settings field with the
 * delete refused for the right reason, and the account's own email.
 */
const ORG_SCREENS = [
  {
    route: '/runs',
    assert: async () => {
      expect(await page.locator('main').innerText(), '/runs is not in its empty state').toContain('No runs yet');
    },
  },
  {
    route: '/usage',
    assert: async () => {
      expect(await page.getByTestId('usage-total').innerText(), 'the Usage total is not $0.00').toBe('$0.00');
      expect(await page.locator('tbody tr').filter({ hasText: PROJECT_NAME }).count(), 'Usage has no row for this run’s project').toBe(1);
    },
  },
  {
    route: '/settings',
    assert: async () => {
      expect(await page.getByLabel('Name').inputValue(), 'the organisation name field is not prefilled').not.toBe('');
      expect(await page.locator('tbody tr').count(), 'the members table should hold exactly the throwaway').toBe(1);
      expect(await page.locator('tbody').innerText()).toContain('you');
      const del = page.getByRole('button', { name: 'Delete organisation' });
      expect(await del.isDisabled(), 'Delete organisation is live on a personal organisation').toBe(true);
      expect(await page.locator('main').innerText()).toContain('Your personal organisation cannot be deleted');
    },
  },
  {
    route: '/account',
    assert: async () => {
      expect(await page.locator('main').innerText(), '/account does not show the signed-in email').toContain(EMAIL);
      expect(await page.getByRole('radio', { name: /Dark/ }).count()).toBe(1);
    },
  },
] as const;

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
 *
 * The pointer is parked in the bottom-right corner first, for the same
 * stability: Playwright keeps the virtual mouse wherever the last click left it
 * — the theme menu — and a row or a button under it would be photographed
 * wearing its hover state.
 */
const shoot = async (p: Page, file: string, fullPage = true) => {
  await p.mouse.move(1435, 895);
  await p.screenshot({ path: path.join(SCREENS, file), fullPage, animations: 'disabled' });
};

/** `/projects` -> `projects`. */
const screenSlug = (route: string) => route.replace(/^\//, '').replaceAll('/', '-');

const EMAIL = `smoke-${Date.now()}@example.com`;
/** The project this run creates through the dialog — also `ORG_SCREENS`' proof row on `/usage`. */
const PROJECT_NAME = `Smoke ${Date.now()}`;

let browser: Browser;
let context: BrowserContext;
let page: Page;
/** The project this run creates through the dialog; deleted in `afterAll`. */
let projectId: string | null = null;
/** The same project's slug — what the plan 2 screens are addressed by. */
let projectSlug: string | null = null;
/** The website added through the dialog — what the plan 3 screens are addressed by. */
let websiteSlug: string | null = null;

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

/**
 * Flip the theme through the user menu *without* reloading: the menu flips
 * `data-theme` on the spot, so a screen whose state lives only in the page —
 * suggestions carried from another product are never saved — can be
 * photographed in both themes without losing what is on it.
 */
async function flipThemeInPlace(p: Page, theme: Theme) {
  await p.locator('aside button').filter({ hasText: EMAIL }).first().click();
  await p.getByRole('menuitem', { name: 'Theme' }).click();
  const saved = p.waitForResponse((r) => r.url().includes('auth.setTheme'), { timeout: 15_000 }).catch(() => null);
  await p.getByRole('menuitemradio', { name: theme === 'dark' ? 'Dark' : 'Light' }).click();
  await saved;
  await p.keyboard.press('Escape');
  await expect.poll(() => p.evaluate(() => document.documentElement.dataset.theme), { timeout: 10_000 }).toBe(theme);
}

/** A Verification tab state in both themes, the current one first; leaves the page in the theme it found. */
async function shootBothThemes(p: Page, name: string) {
  const current = (await p.evaluate(() => document.documentElement.dataset.theme)) as Theme;
  const other: Theme = current === 'dark' ? 'light' : 'dark';
  // The viewport, not the full page: after a click on the screenshot the
  // document stays scrolled a little (something puts it back after a
  // scrollTo), and a full-page capture of a scrolled document draws the
  // sticky sidebar and breadcrumb at the scroll offset, over the title. The
  // 1440×900 viewport holds the table, the top of the screenshot and the
  // whole sidebar.
  await shoot(p, `app-site-verification-${name}-${current}.png`, false);
  await flipThemeInPlace(p, other);
  await shoot(p, `app-site-verification-${name}-${other}.png`, false);
  await flipThemeInPlace(p, current);
}

/**
 * A cell of the verification table, by the state word its label ends in:
 * "Price on product 2: suggested" -> "suggested" (empty, suggested, accepted
 * or failed). `null` while the cell is not on the page.
 */
async function cellState(name: string, product: number): Promise<string | null> {
  const cell = page.locator(`button[aria-label^="${name} on product ${product}: "]`);
  if ((await cell.count()) !== 1) return null;
  return ((await cell.getAttribute('aria-label')) ?? '').slice(`${name} on product ${product}: `.length);
}

/**
 * What a field's row needs, as its last column reads, whitespace folded:
 * "agreed Accept", "missing on product 1", "same on every product — check it
 * Accept anyway", or nothing once every cell is accepted and nothing is verified.
 */
async function rowStatusText(name: string): Promise<string> {
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${name}\\b`) }) });
  return (await row.locator('td').last().innerText()).replace(/\s+/g, ' ').trim();
}

/** The one button on the Verification tab that can spend. Found to be read, never clicked. */
const verifyButtonOf = (p: Page) => p.getByRole('button', { name: /^Verify/ });

beforeAll(async () => {
  if (!ENABLED) return;
  const served = await serveShop();
  shop = served.server;
  SHOP = served.origin;
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
  // The api-server's capture browser may still hold a keep-alive connection.
  shop?.closeAllConnections();
  await new Promise<void>((resolve) => (shop ? shop.close(() => resolve()) : resolve()));
});

describe.skipIf(!ENABLED)('app shell', () => {
  it('a project created through the dialog appears in the table', async () => {
    problems.length = 0;
    await page.goto(`${APP}/projects`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');

    // From the empty state or from the header — whichever "New project" is on
    // screen; the page deliberately never shows both.
    await page.getByRole('button', { name: 'New project' }).first().click();
    await page.getByLabel('Name').fill(PROJECT_NAME);
    await page.getByRole('button', { name: 'Create project' }).click();

    await page.getByRole('cell', { name: PROJECT_NAME, exact: true }).waitFor({ timeout: 20_000 });
    expect(problems, `creating a project logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);

    // The id for the cleanup and the slug for the screens below, read back
    // through the same session that made it.
    const rows = await apiAs(await sessionCookie(context)).projects.list.query();
    const row = rows.find((r) => r.name === PROJECT_NAME);
    projectId = row?.id ?? null;
    projectSlug = row?.slug ?? null;
    expect(projectId, 'the new project is not in projects.list').not.toBeNull();
    expect(projectSlug, 'the new project has no slug').not.toBeNull();
  }, 120_000);

  // Below here, `ORG_SCREENS`' `/usage` assertion needs `PROJECT_NAME` in
  // `projects.list` — hence this loop runs after the project above is made,
  // not before it.
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

        const screen = ORG_SCREENS.find((s) => s.route === route);
        if (screen) await screen.assert();

        await shoot(page, `app-${screenSlug(route)}-${theme}.png`);
      }
    }, 180_000);
  }

  it('a website added through the dialog lands on its Verification tab and appears on the project home', async () => {
    expect(projectSlug, 'there is no project to add a website to').not.toBeNull();
    problems.length = 0;
    await page.goto(`${APP}/projects/${projectSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');

    // The address is this run's own shop, so the Verification tab below has
    // real pages to capture. The trigger and the dialog's submit share the
    // name "Add website", so the submit is asked for inside the dialog.
    await page.getByRole('button', { name: 'Add website' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Address').fill(websiteUrl());
    // The name is derived from the address, so the prefill is what proves the
    // form is live before anything is submitted.
    await expect.poll(() => dialog.getByLabel('Name').inputValue(), { timeout: 10_000 }).toBe(WEBSITE_NAME);
    await dialog.getByRole('button', { name: 'Add website' }).click();

    // Add website lands on the new website's Verification tab (spec
    // 2026-09-25 §2.6) — and the project has no fields yet, so the tab says
    // that and offers the way to the Fields page, and nothing else.
    await page.waitForURL(new RegExp(`/projects/${projectSlug}/sites/[^/?]+$`), { timeout: 20_000 });
    // The link, not the sentence: the project home says "no fields yet" too,
    // and it is still on screen for a moment after the URL has changed.
    await page.getByRole('link', { name: 'Add fields' }).waitFor({ timeout: 20_000 });
    expect(await page.locator('main').innerText(), 'the tab does not say why it is empty').toContain('This project has no fields yet');
    expect(await page.getByRole('textbox', { name: 'Listing page' }).count(), 'the listing bar is on a tab with no fields').toBe(0);

    // The slug the website screens are addressed by, read back through the
    // same session that made it rather than derived from the name by hand.
    const project = await apiAs(await sessionCookie(context)).projects.get.query({ projectSlug: projectSlug! });
    websiteSlug = project.websites.find((w) => w.name === WEBSITE_NAME)?.slug ?? null;
    expect(websiteSlug, 'the new website is not in projects.get').not.toBeNull();
    expect(new URL(page.url()).pathname, 'Add website landed somewhere else').toBe(`/projects/${projectSlug}/sites/${websiteSlug}`);

    // And the project home lists it.
    await page.goto(`${APP}/projects/${projectSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.locator('tbody tr').filter({ hasText: WEBSITE_HOST }).first().waitFor({ timeout: 20_000 });
    expect(problems, `adding a website logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 120_000);

  it('fields picked from the catalogue appear in the list', async () => {
    expect(projectSlug, 'there is no project to add a field to').not.toBeNull();
    problems.length = 0;
    await page.goto(`${APP}/projects/${projectSlug}/fields`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');

    // A chip carries its type beside its name, so the accessible name is
    // "Price Money" — which is also what tells it apart from "Was price" and
    // "Unit price".
    for (const f of FIELDS) {
      await page.getByRole('button', { name: `${f.name} ${f.type}`, exact: true }).click();
      await page.getByRole('textbox', { name: `Name of ${f.name}` }).waitFor({ timeout: 20_000 });
    }
    expect(problems, `adding fields logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 120_000);

  for (const theme of THEMES) {
    it(`every project screen renders in the ${theme} theme`, async () => {
      expect(projectSlug, 'there is no project to walk').not.toBeNull();
      const base = `${APP}/projects/${projectSlug}`;
      await page.goto(base, { waitUntil: 'networkidle', timeout: 30_000 });
      await waitForHydration(page, 'aside');
      await chooseTheme(page, theme);

      for (const screen of PROJECT_SCREENS) {
        problems.length = 0;
        const response = await page.goto(base + screen.route, { waitUntil: 'networkidle', timeout: 30_000 });
        expect(response?.ok(), `${screen.route || '/'} returned HTTP ${response?.status()}`).toBe(true);

        // Queries resolve after first paint; give them a moment to fail if they will.
        await page.waitForTimeout(1200);

        expect(
          await page.evaluate(() => document.documentElement.dataset.theme),
          `${screen.name} is not in the ${theme} theme`,
        ).toBe(theme);
        expect(await page.locator('h1').count(), `${screen.name} has no page title`).toBeGreaterThan(0);
        // The project's own section of the sidebar: its name, its three links.
        expect(
          await page.locator('aside').getByRole('link', { name: 'Fields' }).count(),
          `${screen.name} lost the sidebar's project section`,
        ).toBe(1);
        await screen.assert();
        expect(problems, `${screen.name} logged errors in ${theme}:\n  ${problems.join('\n  ')}`).toEqual([]);

        await shoot(page, `app-project-${screen.name}-${theme}.png`);
      }
    }, 180_000);
  }

  it('the Verification table accepts what agrees and opens the screenshot for what needs you', async () => {
    expect(websiteSlug, 'there is no website to set up').not.toBeNull();
    problems.length = 0;
    const api = apiAs(await sessionCookie(context));
    const site = await api.sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! });
    const productUrls = PRODUCTS.map((p) => `${SHOP}${p.path}`);

    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'input[aria-label="Listing page"]');
    // No product yet: the listing bar, and the line that says what to do.
    await expect.poll(() => page.locator('main').innerText(), { timeout: 20_000 }).toContain('Find products from a listing page');
    await shootBothThemes(page, 'empty');

    // 1. The listing: one page load, three column heads named by the
    // listing's own link text — and not the "About the shop" link.
    await page.getByRole('textbox', { name: 'Listing page' }).fill(`${SHOP}/l`);
    await page.getByRole('button', { name: 'Find products' }).click();
    await expect.poll(() => page.locator('main').innerText(), { timeout: 60_000 }).toContain('3 products found');
    const card = (title: string) => page.getByRole('button', { name: new RegExp(`^${title}`) });
    for (const p of PRODUCTS) {
      expect(await card(p.title).count(), `no column head reads "${p.title}"`).toBe(1);
    }
    expect(await page.getByRole('button', { name: /^About the shop/ }).count(), 'the About link became a product').toBe(0);
    // The table is there, and no screenshot is open until a cell asks for one.
    expect(await page.getByRole('region', { name: 'Screenshot' }).count(), 'a screenshot opened before any click').toBe(0);

    // 2. Every product's screenshot is taken in the background, at most three at once.
    await expect
      .poll(() => page.getByText('ready', { exact: true }).count(), { timeout: 90_000, interval: 1000 })
      .toBe(3);

    // 3. Before any click, what each row needs. The shop's JSON-LD names Title
    // and Price on every product, by one path, on one element each, with values
    // that differ: both agree. Nothing names a rating: that row needs you.
    await expect.poll(() => rowStatusText('Title'), { timeout: 30_000 }).toBe('agreed Accept');
    await expect.poll(() => rowStatusText('Price'), { timeout: 30_000 }).toBe('agreed Accept');
    expect(await rowStatusText('Rating'), 'Rating does not say what it needs').toBe('missing on product 1');
    for (const f of ['Title', 'Price']) {
      for (let i = 1; i <= 3; i++) expect(await cellState(f, i), `${f} on product ${i} is not a suggestion`).toBe('suggested');
    }
    for (let i = 1; i <= 3; i++) expect(await cellState('Rating', i), `Rating on product ${i} is not empty`).toBe('empty');
    const acceptAll = page.getByRole('button', { name: /^Accept all agreed \(\d+\)$/ });
    expect(await acceptAll.innerText()).toBe('Accept all agreed (2)');
    await shootBothThemes(page, 'table');

    // 4. One click accepts both agreed rows; the row that needs you is untouched.
    await acceptAll.click();
    for (const f of ['Title', 'Price']) {
      for (let i = 1; i <= 3; i++) {
        await expect.poll(() => cellState(f, i), { timeout: 10_000, message: `${f} on product ${i} was not accepted` }).toBe('accepted');
      }
    }
    for (let i = 1; i <= 3; i++) expect(await cellState('Rating', i), `Accept all agreed touched Rating on product ${i}`).toBe('empty');
    expect(await acceptAll.innerText()).toBe('Accept all agreed (0)');
    expect(await acceptAll.isDisabled(), 'Accept all agreed is live with nothing agreed').toBe(true);
    expect(await page.locator('main').innerText(), 'the disabled Accept all agreed does not say why').toContain('Nothing agreed to accept');

    // 5. The row that needs you: its cell opens product 1's screenshot, with
    // the product named over it and the cell outlined as the one on screen.
    await page.getByRole('button', { name: 'Rating on product 1: empty', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Screenshot' });
    await panel.waitFor({ timeout: 10_000 });
    expect(await panel.getByRole('heading').innerText(), 'the screenshot is not named for its product').toBe(`${PRODUCTS[0].title} — screenshot`);
    await expect.poll(() => new URL(page.url()).searchParams.get('product'), { timeout: 10_000 }).toBe('1');
    expect(new URL(page.url()).searchParams.get('field'), 'the open cell is not in the address').toBe('rating');
    // ...and on screen: the panel opens under the table, below the fold, so
    // the click has to bring it into view (Rating has no element outlined
    // yet, so the whole screenshot frame is what must be visible).
    const shot = page.locator('img[alt="Screenshot of this product"]');
    await shot.waitFor({ timeout: 20_000 });
    await expect
      .poll(
        () =>
          shot.evaluate((img) => {
            const r = img.closest('.overflow-auto')!.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight + 1;
          }),
        { timeout: 5_000, message: 'the screenshot a cell opened is not on screen' },
      )
      .toBe(true);

    // Point at the rating on the screenshot and name it. Where the element is
    // comes from the capture's own box map, read through the same session; the
    // click lands where the viewer draws that box (its rect × the scale the
    // screenshot is shown at, from the frame's top left corner).
    const captures = await api.sources.proofPageCaptures.query({ sourceId: site.id, urls: [productUrls[0]!] });
    const captureId = captures[productUrls[0]!]?.captureId;
    expect(captureId, 'product 1 has no capture').toBeTruthy();
    const capture = await api.sources.proofPageCapture.query({ captureId: captureId! });
    const ratingBoxes = capture.boxes.filter((b) => b.text.trim() === PRODUCTS[0].rating);
    expect(ratingBoxes.length, `no element on product 1 reads ${PRODUCTS[0].rating}`).toBeGreaterThan(0);
    const rating = ratingBoxes.sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0]!.rect;
    await shot.scrollIntoViewIfNeeded();
    const scale = await shot.evaluate((img: HTMLImageElement) => img.getBoundingClientRect().width / img.naturalWidth);
    const frame = await shot.boundingBox();
    if (!frame) throw new Error('the screenshot is not on screen');
    await page.mouse.click(frame.x + (rating.x + rating.w / 2) * scale, frame.y + (rating.y + rating.h / 2) * scale);
    const popover = page.locator('[data-slot="popover-content"]');
    await popover.waitFor({ timeout: 10_000 });
    expect(await popover.innerText(), 'the popover does not show the value it read').toContain(PRODUCTS[0].rating);
    const fieldPicker = popover.getByRole('combobox');
    if (!(await fieldPicker.innerText()).includes('Rating')) {
      await fieldPicker.click();
      await page.getByRole('option', { name: /^Rating/ }).click();
    }
    await popover.getByRole('button', { name: 'Confirm Rating', exact: true }).click();
    await expect.poll(() => cellState('Rating', 1), { timeout: 10_000 }).toBe('accepted');

    // 6. The mark is carried to the other two products by its own path, so
    // the row now agrees: one more click accepts it.
    await expect.poll(() => rowStatusText('Rating'), { timeout: 20_000 }).toBe('agreed Accept');
    await page.getByRole('button', { name: 'Accept Rating', exact: true }).click();
    for (let i = 1; i <= 3; i++) {
      await expect.poll(() => cellState('Rating', i), { timeout: 10_000, message: `Rating on product ${i} was not accepted` }).toBe('accepted');
    }

    // 7. × closes the screenshot and takes the product out of the address.
    await page.getByRole('button', { name: 'Close screenshot' }).click();
    await expect.poll(() => panel.count(), { timeout: 10_000 }).toBe(0);
    expect(new URL(page.url()).searchParams.get('product'), 'the closed screenshot is still in the address').toBeNull();

    // 8. Every answer autosaves: the line under Verify says so, and the server
    // has all nine before the reload that proves it.
    await expect
      .poll(
        async () => {
          const s = await api.sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! });
          const expected = (s.verificationSet as { expected?: Record<string, Record<string, string>> } | null)?.expected ?? {};
          return FIELDS.every((f) => {
            const key = f.name.toLowerCase();
            return productUrls.every((u) => (expected[key]?.[u] ?? '').trim() !== '');
          });
        },
        { timeout: 20_000, interval: 500 },
      )
      .toBe(true);
    await expect.poll(() => page.getByText('saved', { exact: true }).count(), { timeout: 10_000 }).toBe(1);

    // 9. After a reload every cell is still accepted. (A row's "agreed" is not
    // asserted here: suggestions carried from another product are never
    // saved, so only accepted cells are what a reload must keep.)
    await page.reload({ waitUntil: 'networkidle' });
    await waitForHydration(page, 'input[aria-label="Listing page"]');
    for (const f of FIELDS) {
      for (let i = 1; i <= 3; i++) {
        await expect
          .poll(() => cellState(f.name, i), { timeout: 20_000, message: `${f.name} on product ${i} did not survive the reload` })
          .toBe('accepted');
      }
    }
    // Ready to verify, and priced before the click — which this run never makes.
    const verify = verifyButtonOf(page);
    await expect.poll(() => verify.isEnabled(), { timeout: 20_000 }).toBe(true);
    expect(await verify.innerText(), 'the Verify button does not say what it costs').toMatch(/^Verify \d+ fields? · (free|up to \$\d)/);
    await expect.poll(() => page.getByText('ready', { exact: true }).count(), { timeout: 60_000 }).toBe(3);

    // 10. What the server stored: Rating's mark on product 1, and the cards
    // with the listing's titles, so the table comes back without the listing.
    const stored = (await api.sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! })).verificationSet as {
      marks?: Record<string, Record<string, unknown>>;
      cards?: Array<{ url: string; title: string }>;
    } | null;
    expect(stored?.marks?.rating?.[productUrls[0]!], 'Rating on product 1 was saved without its mark').toBeTruthy();
    expect(stored?.cards?.map((c) => c.title), 'the cards were not saved with their titles').toEqual(PRODUCTS.map((p) => p.title));

    expect(problems, `the Verification tab logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 300_000);

  for (const theme of THEMES) {
    it(`every website screen renders in the ${theme} theme`, async () => {
      expect(websiteSlug, 'there is no website to walk').not.toBeNull();
      const base = `${APP}/projects/${projectSlug}/sites/${websiteSlug}`;
      await page.goto(base, { waitUntil: 'networkidle', timeout: 30_000 });
      await waitForHydration(page, 'aside');
      await chooseTheme(page, theme);

      for (const screen of SITE_SCREENS) {
        problems.length = 0;
        const response = await page.goto(base + screen.route, { waitUntil: 'networkidle', timeout: 30_000 });
        expect(response?.ok(), `${screen.route || '/'} returned HTTP ${response?.status()}`).toBe(true);

        // Queries resolve after first paint; give them a moment to fail if they will.
        await page.waitForTimeout(1500);

        expect(
          await page.evaluate(() => document.documentElement.dataset.theme),
          `${screen.name} is not in the ${theme} theme`,
        ).toBe(theme);
        // The layout owns the title and the strip, so every tab has both.
        expect(await page.locator('h1').count(), `${screen.name} has no page title`).toBeGreaterThan(0);
        expect(
          await page.locator('nav[aria-label="Website"] a').count(),
          `${screen.name} lost the website's tab strip`,
        ).toBe(4);
        await screen.assert();
        expect(problems, `${screen.name} logged errors in ${theme}:\n  ${problems.join('\n  ')}`).toEqual([]);

        await shoot(page, `app-site-${screen.name}-${theme}.png`);
      }
    }, 240_000);
  }

  it('a rename on the Settings tab reaches the server and comes back', async () => {
    expect(websiteSlug, 'there is no website to rename').not.toBeNull();
    const renamed = `${WEBSITE_NAME} renamed`;
    problems.length = 0;
    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}/settings`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await waitForHydration(page, 'main');

    // `InlineRename` commits on blur, and the title in the header reads the same
    // query — so the header agreeing is the round trip, not an optimistic echo.
    const nameRow = page.getByRole('textbox', { name: 'Name', exact: true });
    await nameRow.fill(renamed);
    await nameRow.blur();
    await expect.poll(() => page.locator('h1 input').inputValue(), { timeout: 20_000 }).toBe(renamed);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    expect(await page.locator('h1 input').inputValue(), 'the rename did not survive the reload').toBe(renamed);

    // Back to the name the screens above are captured under.
    const again = page.getByRole('textbox', { name: 'Name', exact: true });
    await again.fill(WEBSITE_NAME);
    await again.blur();
    await expect.poll(() => page.locator('h1 input').inputValue(), { timeout: 20_000 }).toBe(WEBSITE_NAME);
    expect(problems, `renaming logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 120_000);

  it('renaming the account reaches the server and the sidebar', async () => {
    await page.goto(`${APP}/account`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'aside');
    const name = `Smoke ${Date.now()}`;
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect.poll(() => page.locator('aside').innerText(), { timeout: 10_000 }).toContain(name);
    const cookie = await sessionCookie(context);
    expect((await apiAs(cookie!).auth.me.query()).user.name).toBe(name);
  }, 120_000);

  it('renaming the organisation reaches the server and the breadcrumb', async () => {
    await page.goto(`${APP}/settings`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'aside');
    const name = `Smoke org ${Date.now()}`;
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect.poll(() => page.locator('header nav').innerText(), { timeout: 10_000 }).toContain(name);
    const cookie = await sessionCookie(context);
    expect((await apiAs(cookie!).auth.me.query()).currentOrg.name).toBe(name);
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
