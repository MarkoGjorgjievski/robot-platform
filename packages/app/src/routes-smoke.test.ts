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
// The shop also serves two walls (honest page verdicts, 2026-10-09): `/blocked`,
// a 403 Cloudflare page, and `/captcha`, a 200 human check. The last test
// pastes `/blocked` as the listing and reads its one sentence. That wall puts
// the shop's host (127.0.0.1) on backoff in the api-server for 2 minutes
// (`BACKOFF_FIRST_MS`), and while it lasts every interactive path — Find
// products, a proof-page capture, the new-website reachability line — answers
// from the backoff without loading the page: the wall's own sentence and
// "Waiting n min before trying again." (fix wave I4). So the test then pastes
// `/captcha` and reads exactly that answer, not the human check (the
// classifier's reading of a 200 human check is pinned by @robot/browser's
// capture-verdict test). The wall test runs LAST, after everything else that
// touches the shop; and a second run against the same api-server must start
// at least two minutes after the first one ended. Do NOT shorten the backoff
// (`ROBOT_BACKOFF_FIRST_MS`, read once at import by
// `packages/scraper/src/domain-lock.ts`) for this smoke: the step asserts
// "Waiting 2 min", and a 1-second backoff has expired by the second click, so
// `/captcha` would really be captured and the step would read the human check.
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
// By relative path: these are test helpers of `@robot/api`, not part of its
// public surface.
import { SHOP_EXAMPLE } from '../../api/src/test-helpers/shop-example';
import { seedCompletedVariantsRun } from '../../api/src/test-helpers/seed-variants-run';
import { seedDriftCheck } from '../../api/src/test-helpers/seed-drift-check';

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
/**
 * A shop's footer, on every page it serves except the walls. Since honest page
 * verdicts (2026-10-09) a page with under 100 characters of text reads as
 * "sent an empty page", and the shop-example pages alone are shorter than that
 * — a real shop's are not. No digits or prices, so no row suggests a value from it.
 */
const SHOP_FOOTER =
  '<footer><p>Widget shop: free delivery, easy returns and a friendly guarantee on every widget we sell. Questions about an order? Write to us any time and we will answer within a day.</p></footer>';

function shopPage(pathname: string): { type: string; body: string | Buffer; status?: number; headers?: Record<string, string> } | null {
  if (pathname === '/' || pathname === '/about') {
    return { type: 'text/html', body: `<html><head><title>Widget shop</title></head><body><h1>Widget shop</h1>${SHOP_FOOTER}</body></html>` };
  }
  // The two walls the last test pastes: a Cloudflare refusal and a human check.
  if (pathname === '/blocked') {
    return {
      type: 'text/html',
      status: 403,
      headers: { server: 'cloudflare', 'cf-ray': 'smoke' },
      body: '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing. Ray ID: smoke</body></html>',
    };
  }
  if (pathname === '/captcha') {
    return { type: 'text/html', body: '<html><head><title>Verify you are human</title></head><body><p>Verify you are human to continue.</p></body></html>' };
  }
  if (pathname === '/l') {
    const cards = PRODUCTS.map((p, i) => `<li><a href="${p.path}"><img src="/i/${i + 1}.png" alt=""><span>${p.title}</span></a></li>`).join('');
    return {
      type: 'text/html',
      body: `<html><head><title>All widgets</title></head><body><h1>All widgets</h1><ul class="grid">${cards}</ul><a href="/about">About the shop</a>${SHOP_FOOTER}</body></html>`,
    };
  }
  if (/^\/(i|img)\/[\w.-]+$/.test(pathname)) return { type: 'image/png', body: PIXEL };
  const product = PRODUCTS.find((p) => p.path === pathname);
  if (!product) return null;
  // The product's own SKU, in its page data and on the page (the shop-example
  // page keeps it in an empty element's attribute): what the SKU row reads.
  const sku = /data-sku="([^"]+)"/.exec(product.page.html)?.[1] ?? '';
  const group = variantGroup(product.path);
  const ld = [...product.page.structuredData.ldJson.map((j, i) => (i === 0 ? { ...(j as object), sku } : j)), ...(group ? [group] : [])]
    .map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`)
    .join('');
  const html = product.page.html.replace(`data-sku="${sku}"></span>`, `data-sku="${sku}">${sku}</span>`).replace('</body>', `${SHOP_FOOTER}</body>`);
  return { type: 'text/html', body: html.replace('<html>', `<html><head><title>${product.title}</title>${ld}</head>`) };
}

/**
 * Products 1 and 2 come in colours — two and three — said the way a shop's
 * page data says it: a `ProductGroup` whose `hasVariant` lists one entry per
 * colour (spec 2026-10-01 §3, "Listed in the page data"). Product 3 has none.
 * The entries carry a colour, a SKU and the product's own price, and no name —
 * so the Title row above still finds one value each, and the variants' Price,
 * SKU and Colour are there to be suggested when one variant is checked.
 */
const VARIANT_COLOURS: Record<string, readonly string[]> = { '/p/1': ['Red', 'Blue'], '/p/2': ['Black', 'White', 'Grey'] };
function variantGroup(productPath: string) {
  const colours = VARIANT_COLOURS[productPath];
  if (!colours) return null;
  const id = productPath.replace(/\W/g, '');
  const price = PRODUCTS.find((p) => p.path === productPath)!.price.replace(/^\$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    variesBy: ['https://schema.org/color'],
    hasVariant: colours.map((color) => ({
      '@type': 'Product',
      color,
      sku: `${id}-${color.toLowerCase()}`,
      offers: { '@type': 'Offer', price, priceCurrency: 'USD' },
    })),
  };
}

function serveShop(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const found = shopPage(new URL(req.url ?? '/', 'http://x').pathname);
    if (!found) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(found.status ?? 200, { 'content-type': found.type, ...(found.headers ?? {}) }).end(found.body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

/**
 * Plan 2's three screens plus the cut-over's Settings, each with the one thing
 * that proves it is the real screen and not an empty shell: the website that
 * was just added, the field that was just picked, the empty sheet a project
 * with no run has, and the project's own name in its Name row.
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
  {
    name: 'settings',
    route: '/settings',
    assert: async () => {
      expect(
        await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(),
        'the Name row does not hold the project name',
      ).toBe(PROJECT_NAME);
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
        expect(await page.getByRole('button', { name: new RegExp(`^${p.title}`) }).count(), `the card for ${p.title} is missing`).toBe(1);
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
      // Scoped to the Members table by its "Role" column: Settings also has a
      // "Robot staff activity" table (2026-10-07) whose empty state is its
      // own `<tr>` ("No staff activity yet."), so an unscoped `tbody tr` sees
      // both tables' rows.
      const membersTable = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Role', exact: true }) });
      expect(await membersTable.locator('tbody tr').count(), 'the members table should hold exactly the throwaway').toBe(1);
      expect(await membersTable.locator('tbody').innerText()).toContain('you');
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
 * throwaway project from the *throwaway* org. Every customer procedure needs a
 * session and works in its org only; without the cookie `projects.delete` is
 * UNAUTHORIZED.
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

/** The viewport in both themes, as `<name>-<theme>.png`, the current theme first; leaves the page in the theme it found. */
async function shootViewportBothThemes(p: Page, name: string) {
  const current = (await p.evaluate(() => document.documentElement.dataset.theme)) as Theme;
  const other: Theme = current === 'dark' ? 'light' : 'dark';
  await shoot(p, `${name}-${current}.png`, false);
  await flipThemeInPlace(p, other);
  await shoot(p, `${name}-${other}.png`, false);
  await flipThemeInPlace(p, current);
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
 * A cell of the verification table, by the state word its label carries:
 * "Price on product 2: suggested, 219.99" -> "suggested" (empty, suggested,
 * accepted or failed). `null` while the cell is not on the page.
 */
async function cellState(name: string, product: number): Promise<string | null> {
  const cell = page.locator(`button[aria-label^="${name} on product ${product}: "]`);
  if ((await cell.count()) !== 1) return null;
  return ((await cell.getAttribute('aria-label')) ?? '').slice(`${name} on product ${product}: `.length).split(',')[0]!;
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
  // Cut-over Task 5 (Global Constraints, Review Focus 1/the app side of it):
  // a non-operator throwaway account never sees ops mode's own chrome, and
  // typing the ops URL redirects it away rather than erroring or rendering.
  it('a fresh throwaway account never sees ops mode, and /ops redirects it to /projects', async () => {
    await page.goto(`${APP}/projects`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('Robot ops');
    expect(bodyText).not.toContain('All websites');
    expect(bodyText).not.toContain('Back to ops');

    await page.goto(`${APP}/ops`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForURL(`${APP}/projects`, { timeout: 30_000 });
  });

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
        // The project's own section of the sidebar: its name, its four links.
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
    // A new website — no products, no listing — says whether the browser can
    // read its address. The line sits under the listing bar, which needs
    // fields, so it is read here rather than on Add website's landing (no
    // fields yet there). The shop's host has seen no wall yet: that test is last.
    await expect.poll(() => page.locator('main').innerText(), { timeout: 30_000 }).toContain(`Reached ${WEBSITE_HOST} (HTTP 200).`);
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
    // A cell's name carries its value, not only its state (final review M2).
    expect(
      await page.locator('button[aria-label^="Title on product 1: "]').getAttribute('aria-label'),
      'the Title cell does not name its value',
    ).toBe(`Title on product 1: suggested, ${PRODUCTS[0].title}`);
    // A suggestion found in one place can be accepted from its cell (spec 2026-09-29 A7); an empty cell cannot.
    for (let i = 1; i <= 3; i++) {
      expect(await page.getByRole('button', { name: `Accept Title on product ${i}`, exact: true }).count(), `Title on product ${i} has no one-click accept`).toBe(1);
      expect(await page.getByRole('button', { name: `Accept Rating on product ${i}`, exact: true }).count(), `the empty Rating on product ${i} offers an accept`).toBe(0);
    }
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

    // 4b. Spreadsheet behaviour (spec 2026-10-07). A click on a cell selects
    // it and nothing else: the bar above the table shows the value, no
    // screenshot opens, and the address stays clean.
    const bar = page.getByRole('region', { name: 'Selected cell' });
    expect((await bar.innerText()).replace(/\s+/g, ' ')).toContain('Select a cell to see its full value.');
    await page.getByRole('button', { name: `Title on product 1: accepted, ${PRODUCTS[0].title}`, exact: true }).click();
    await expect.poll(() => bar.locator('[data-testid="selected-value"]').innerText(), { timeout: 5_000 }).toBe(PRODUCTS[0].title);
    expect((await bar.innerText()).replace(/\s+/g, ' ')).toContain(`Title · ${PRODUCTS[0].title} (product 1)`);
    expect((await bar.innerText()).replace(/\s+/g, ' ')).toContain('accepted');
    expect(await page.getByRole('region', { name: 'Screenshot' }).count(), 'a cell click opened the screenshot').toBe(0);
    expect(new URL(page.url()).searchParams.get('product'), 'a cell click put the product in the address').toBeNull();
    const selectedLabel = () => page.locator('button[data-cell][data-selected="true"]').getAttribute('aria-label');
    expect(await selectedLabel()).toMatch(/^Title on product 1: /);
    // The crop of the screenshot around the element is in the bar, read-only.
    expect(await bar.getByRole('button', { name: 'Open the screenshot to fix Title' }).count(), 'the bar has no screenshot crop').toBe(1);
    await shootBothThemes(page, 'selected');

    // The table never jumps (spec §2): the bar reserves the crop's height, so
    // clearing the selection (and with it the crop) leaves the table where it was.
    const tableTop = () => page.getByRole('table').first().evaluate((el) => el.getBoundingClientRect().top);
    const topSelected = await tableTop();
    await page.locator('button[data-cell][data-selected="true"]').focus();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('button[data-cell][data-selected="true"]').count(), { timeout: 5_000 }).toBe(0);
    const topCleared = await tableTop();
    console.log(`5b table top: selected ${topSelected}px, cleared ${topCleared}px`);
    expect(Math.abs(topSelected - topCleared), `the table moved when the selection cleared (${topSelected} → ${topCleared})`).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: `Title on product 1: accepted, ${PRODUCTS[0].title}`, exact: true }).click();
    await expect.poll(selectedLabel, { timeout: 5_000 }).toMatch(/^Title on product 1: /);

    // Arrow keys move the selection; Home/End jump; nothing opens.
    await page.locator('button[data-cell][data-selected="true"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(selectedLabel, { timeout: 5_000 }).toMatch(/^Title on product 2: /);
    await page.keyboard.press('ArrowDown');
    await expect.poll(selectedLabel, { timeout: 5_000 }).toMatch(/^Price on product 2: /);
    await page.keyboard.press('End');
    await expect.poll(selectedLabel, { timeout: 5_000 }).toMatch(/^Price on product 3: /);
    await page.keyboard.press('ArrowRight'); // clamps: there is an add column after product 3, and it is not a cell
    expect(await selectedLabel()).toMatch(/^Price on product 3: /);
    await page.keyboard.press('Home');
    await expect.poll(selectedLabel, { timeout: 5_000 }).toMatch(/^Price on product 1: /);
    expect(await page.getByRole('region', { name: 'Screenshot' }).count(), 'a key opened the screenshot').toBe(0);

    // Ctrl+C copies the selected cell; the context menu's Copy value does the
    // same. The cell's display value is not PRODUCTS[0].price's "$" form (it
    // is whatever the cell renders, e.g. normalised from JSON-LD), so the
    // expected value is read from the cell's own aria-label instead.
    const priceLabelBefore = await page.locator('button[aria-label^="Price on product 1: "]').getAttribute('aria-label');
    const priceValue = (priceLabelBefore ?? '').split(', ').slice(1).join(', ');
    expect(priceValue, 'could not read the Price cell value from its aria-label').not.toBe('');
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
    // Probe whether a read is even possible in this browser before trusting
    // its result: a `.catch()`-swallowing try/catch around the real assertion
    // would also hide a regression that copies the wrong cell.
    const canRead = await page.evaluate(() => navigator.clipboard.readText().then(() => true, () => false));
    await page.keyboard.press('Control+C');
    if (canRead) {
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 }).toBe(priceValue);
      // The menu's Copy value copies the same value. Clear the clipboard first
      // so a stale Ctrl+C result cannot pass for it.
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await page.locator('button[data-cell][data-selected="true"]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Copy value' }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 }).toBe(priceValue);
    } else {
      // navigator.clipboard.readText() is refused in this browser even with the
      // grant above, so there is no way to see what was copied: skip the
      // clipboard checks rather than pass on something weaker.
      console.warn('clipboard read refused in this browser; skipping the copy assertions');
    }
    await page.locator('button[data-cell][data-selected="true"]').click({ button: 'right' });
    const menu = page.getByRole('menu');
    await menu.waitFor({ timeout: 5_000 });
    expect((await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim())).toEqual(['Copy value', 'Open product page', 'Fix on screenshot', 'Type it']);
    await page.keyboard.press('Escape');
    await expect.poll(() => menu.count(), { timeout: 5_000 }).toBe(0);

    // Type it expands the row and focuses its Type input for the selected product.
    await page.locator('button[data-cell][data-selected="true"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Type it' }).click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')), { timeout: 5_000 }).toBe('Price on product 1');
    await page.keyboard.press('Escape'); // leaves the input alone (Escape is ignored in a text field)
    await page.getByRole('button', { name: /^Price/, expanded: true }).click(); // collapse the row again

    // Escape on a cell with the screenshot closed clears the selection.
    await page.locator('button[data-cell][data-selected="true"]').focus();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('button[data-cell][data-selected="true"]').count(), { timeout: 5_000 }).toBe(0);
    expect((await bar.innerText()).replace(/\s+/g, ' ')).toContain('Select a cell to see its full value.');

    // The row details (Type it / hint) follow the SELECTED cell's product,
    // not the open screenshot's (Task 8 review): select Price on product 3,
    // then open product 2's screenshot from its column head — the two differ.
    await page.getByRole('button', { name: /^Price on product 3: /, exact: false }).click();
    await expect.poll(selectedLabel, { timeout: 5_000 }).toMatch(/^Price on product 3: /);
    await card(PRODUCTS[1].title).click();
    await page.getByRole('region', { name: 'Screenshot' }).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Price/, expanded: false }).click();
    await page.getByRole('textbox', { name: 'Price on product 3' }).waitFor({ timeout: 5_000 });
    expect(await page.getByRole('textbox', { name: 'Price on product 2' }).count(), 'the details followed the open screenshot instead of the selected cell').toBe(0);
    await page.getByRole('button', { name: /^Price/, expanded: true }).click(); // collapse the row again

    // Escape closes the open screenshot but leaves the cell selected; a
    // second Escape is what clears the selection.
    await page.locator('button[data-cell][data-selected="true"]').focus();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.getByRole('region', { name: 'Screenshot' }).count(), { timeout: 5_000 }).toBe(0);
    expect(await page.locator('button[data-cell][data-selected="true"]').count(), 'Escape over a closed screenshot cleared the selection too').toBe(1);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('button[data-cell][data-selected="true"]').count(), { timeout: 5_000 }).toBe(0);

    // 5. The row that needs you: a click selects its cell; Enter is what
    // opens product 1's screenshot (spec 2026-10-07 §4), with the product
    // named over it and the cell outlined as the one on screen.
    await page.getByRole('button', { name: 'Rating on product 1: empty', exact: true }).click();
    expect(await page.getByRole('region', { name: 'Screenshot' }).count(), 'selecting the empty Rating cell opened the screenshot').toBe(0);
    await page.keyboard.press('Enter');
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
    const clickRating = async () => {
      await shot.scrollIntoViewIfNeeded();
      const scale = await shot.evaluate((img: HTMLImageElement) => img.getBoundingClientRect().width / img.naturalWidth);
      const frame = await shot.boundingBox();
      if (!frame) throw new Error('the screenshot is not on screen');
      await page.mouse.click(frame.x + (rating.x + rating.w / 2) * scale, frame.y + (rating.y + rating.h / 2) * scale);
    };
    await clickRating();
    const popover = page.locator('[data-slot="popover-content"]');
    await popover.waitFor({ timeout: 10_000 });
    expect(await popover.innerText(), 'the popover does not show the value it read').toContain(PRODUCTS[0].rating);

    // The mark popover owns the keyboard: an arrow does not move the selection
    // behind it. Focus stays in the popover here (focusing the cell instead
    // would close it — Radix's non-modal Popover dismisses on focus outside),
    // so the key cannot reach a cell; what this pins is that the popover stays
    // open and the selection put. The table-side guard is the route's
    // `keyboard={!popover && !variantMark}`.
    await page.keyboard.press('ArrowRight');
    expect(await popover.count(), 'an arrow key closed the mark popover').toBe(1);
    expect(await selectedLabel()).toMatch(/^Rating on product 1: /);

    // Escape closes the popover first, and only the popover; a second Escape
    // closes the screenshot (final review H1). Then open both again.
    await page.keyboard.press('Escape');
    await expect.poll(() => popover.count(), { timeout: 5_000, message: 'Escape did not close the popover' }).toBe(0);
    expect(await panel.count(), 'the Escape meant for the popover closed the screenshot').toBe(1);
    await page.keyboard.press('Escape');
    await expect.poll(() => panel.count(), { timeout: 5_000, message: 'a second Escape did not close the screenshot' }).toBe(0);
    // The selection survives the closed screenshot, so its Mark button is on
    // show; that is the other explicit way back in.
    expect(await selectedLabel()).toMatch(/^Rating on product 1: /);
    await page.getByRole('button', { name: 'Mark Rating on product 1 on the screenshot', exact: true }).click();
    await panel.waitFor({ timeout: 10_000 });
    await shot.waitFor({ timeout: 20_000 });
    await clickRating();
    await popover.waitFor({ timeout: 10_000 });
    const fieldPicker = popover.getByRole('combobox');
    if (!(await fieldPicker.innerText()).includes('Rating')) {
      await fieldPicker.click();
      await page.getByRole('option', { name: /^Rating/ }).click();
    }
    await popover.getByRole('button', { name: 'Confirm Rating', exact: true }).click();
    await expect.poll(() => cellState('Rating', 1), { timeout: 10_000 }).toBe('accepted');

    // 6. The mark is carried to the other two products by its own path, so
    // the row now agrees. Product 2's cell is accepted on its own, from the ✓
    // its hover shows (spec 2026-09-29 A7); one more click accepts the rest.
    await expect.poll(() => rowStatusText('Rating'), { timeout: 20_000 }).toBe('agreed Accept');
    await page.locator('button[aria-label^="Rating on product 2: suggested"]').hover();
    await page.getByRole('button', { name: 'Accept Rating on product 2', exact: true }).click();
    await expect.poll(() => cellState('Rating', 2), { timeout: 10_000, message: 'the cell ✓ did not accept Rating on product 2' }).toBe('accepted');
    expect(await cellState('Rating', 3), 'the cell ✓ accepted another product too').toBe('suggested');
    await expect.poll(() => rowStatusText('Rating'), { timeout: 10_000 }).toBe('agreed Accept');
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

  // Variants (spec 2026-10-01 §2–§3), after the website screens above so their
  // screenshots stay the ones a project without variants shows. Free: the
  // detection reads the captures the Verification walk already took. Verify is
  // never pressed.
  it("variants: turned on in the Fields panel, and recorded by the website's Variants step", async () => {
    expect(websiteSlug, 'there is no website to set up variants on').not.toBeNull();
    problems.length = 0;

    // 1. Fields: the panel, off by default; turning it on shows each field's level.
    await page.goto(`${APP}/projects/${projectSlug}/fields`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');
    const panel = page.getByRole('region', { name: 'Variants' });
    await panel.waitFor({ timeout: 20_000 });
    expect(await page.getByRole('radio', { name: 'No variants', exact: true }).isChecked(), 'a new project wants variants').toBe(true);
    expect(await page.getByRole('combobox', { name: 'Variants of Price' }).count(), 'levels are shown while variants are off').toBe(0);
    await page.getByRole('radio', { name: 'One row per variant', exact: true }).click();
    const priceLevel = page.getByRole('combobox', { name: 'Variants of Price' });
    await priceLevel.waitFor({ timeout: 20_000 });
    expect(await priceLevel.innerText(), 'a price is not variant-level by default').toContain('Differs per variant');
    expect(await page.getByRole('combobox', { name: 'Variants of Title' }).innerText(), 'a title is not product-level by default').toContain('Same for every variant');
    expect(await panel.innerText(), 'the panel does not say where variant columns come from').toContain('Variant columns');
    await shootViewportBothThemes(page, 'app-project-fields-variants');

    // 2. The website: what the proof pages show, with the suggestion preselected.
    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'input[aria-label="Listing page"]');
    const step = page.getByRole('region', { name: 'Variants' });
    await expect
      .poll(() => step.innerText().catch(() => ''), { timeout: 120_000, interval: 1000 })
      .toContain('Listed in the page data: 2 colours on product 1, 3 on product 2, none on product 3');
    expect(await page.getByRole('radio', { name: 'Listed in the page data', exact: true }).isChecked(), 'the suggestion is not preselected').toBe(true);
    const column = page.getByRole('combobox', { name: 'Column for Colour' });
    expect(await column.innerText(), 'a colour does not become a new Colour column').toContain('New column ‘Colour’');
    await step.scrollIntoViewIfNeeded();
    await shootViewportBothThemes(page, 'app-site-verification-variants-found');

    // 3. Confirm, and the step is one line — still there after a reload.
    await step.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect.poll(() => step.innerText(), { timeout: 20_000 }).toContain('Variants: listed in the page data · Colour');
    await page.reload({ waitUntil: 'networkidle' });
    await waitForHydration(page, 'input[aria-label="Listing page"]');
    await expect.poll(() => step.innerText().catch(() => ''), { timeout: 20_000 }).toContain('Variants: listed in the page data · Colour');
    expect(await step.getByRole('button', { name: 'Change', exact: true }).count(), 'the confirmed step offers no Change').toBe(1);
    const stored = await apiAs(await sessionCookie(context)).sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! });
    expect(stored.variantSetup?.method, 'the method was not stored').toBe('list');
    expect(stored.variantSetup?.axes.map((a) => a.from), 'the colour mapping was not stored').toEqual(['color']);
    await step.scrollIntoViewIfNeeded();
    await shootViewportBothThemes(page, 'app-site-verification-variants-set');

    // 4. Back on Fields the new column is listed, and deleting it is refused
    // with the website that uses it named. The refusal is an HTTP 412, which
    // the browser logs as a failed load: the one console line this step expects.
    expect(problems, `the variants walk logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
    await page.goto(`${APP}/projects/${projectSlug}/fields`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');
    await page.getByRole('textbox', { name: 'Name of variant column Colour' }).waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Delete variant column Colour' }).click();
    await expect.poll(() => panel.innerText(), { timeout: 10_000 }).toContain(`${WEBSITE_NAME} uses Colour`);
    expect(await page.getByRole('textbox', { name: 'Name of variant column Colour' }).count(), 'the refused delete removed the column').toBe(1);

    const unexpected = problems.filter((line) => !line.includes('status of 412'));
    expect(unexpected, `the refused delete logged errors:\n  ${unexpected.join('\n  ')}`).toEqual([]);
  }, 300_000);

  // Variants plan 2 (spec 2026-10-01 §4.1): the Variants row confirms each
  // product's count and checks one variant. Free: everything here reads the
  // captures already taken. Verify is read for its label, never pressed.
  it('variants: the Variants row confirms the counts and checks one variant', async () => {
    expect(websiteSlug, 'there is no website to confirm variants on').not.toBeNull();
    problems.length = 0;

    // 1. Two more variant-level fields: SKU (suggested from the list) and In
    // stock (which the list does not carry — taken from the product page).
    await page.goto(`${APP}/projects/${projectSlug}/fields`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');
    for (const f of [{ name: 'SKU', type: 'Text' }, { name: 'In stock', type: 'Yes / no' }]) {
      await page.getByRole('button', { name: `${f.name} ${f.type}`, exact: true }).click();
      await page.getByRole('textbox', { name: `Name of ${f.name}` }).waitFor({ timeout: 20_000 });
    }

    // 2. Back on the website, every field is answered on every product, so
    // Verify is only waiting on the variants.
    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'input[aria-label="Listing page"]');
    await expect.poll(() => page.getByText('ready', { exact: true }).count(), { timeout: 90_000, interval: 1000 }).toBe(3);
    for (const f of ['SKU', 'In stock']) {
      for (let i = 1; i <= 3; i++) {
        await expect.poll(async () => {
          const state = await cellState(f, i);
          if (state === 'suggested') {
            const accept = page.getByRole('button', { name: `Accept ${f} on product ${i}`, exact: true });
            if ((await accept.count()) === 1) await accept.click({ force: true });
          }
          return state;
        }, { timeout: 30_000, message: `${f} on product ${i} could not be accepted` }).toBe('accepted');
      }
    }

    // 3. The row: 2 and 3 colours found (orange), none on product 3 (grey).
    const cell = (n: number) => page.locator(`[aria-label^="Variants on product ${n}: "]`);
    await expect.poll(() => cell(1).getAttribute('aria-label'), { timeout: 30_000 }).toBe('Variants on product 1: 2 colours');
    expect(await cell(2).getAttribute('aria-label')).toBe('Variants on product 2: 3 colours');
    expect(await cell(3).getAttribute('aria-label')).toBe('Variants on product 3: No variants');
    expect(await cell(1).getAttribute('class'), 'a found count is not orange').toContain('border-warn');
    expect(await cell(3).getAttribute('class'), 'nothing found is not grey').toContain('border-line');
    // Until every product's variants are confirmed, Verify does not offer them.
    expect(await verifyButtonOf(page).innerText(), 'Verify offers variants nobody confirmed').not.toContain('and variants');

    // 4. Tick both counts, and "No variants on this product" on product 3.
    await page.getByRole('button', { name: 'Confirm the variants of product 1', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm the variants of product 2', exact: true }).click();
    await page.getByRole('button', { name: 'No variants on product 3', exact: true }).click();
    await expect.poll(() => cell(1).getAttribute('class'), { timeout: 20_000 }).toContain('border-pass');
    await expect.poll(() => cell(2).getAttribute('class'), { timeout: 20_000 }).toContain('border-pass');
    await expect.poll(() => cell(3).getAttribute('aria-label'), { timeout: 20_000 }).toBe('Variants on product 3: No variants on this product');

    // 5. Expand: the first variant of each is checked. Accept its suggested
    // Price, SKU and Colour, and take In stock from the product page.
    await page.getByRole('rowheader', { name: /^Variants/ }).getByRole('button').click();
    await expect.poll(() => page.locator('main').innerText(), { timeout: 20_000 }).toContain('Check this one');
    for (const n of [1, 2]) {
      for (const f of ['Price', 'SKU', 'Colour']) {
        const accept = page.getByRole('button', { name: `Accept ${f} of the checked variant on product ${n}`, exact: true });
        await accept.waitFor({ timeout: 20_000 });
        await accept.click();
      }
      await page.getByRole('button', { name: `In stock of product ${n} from the product page`, exact: true }).click();
    }

    // 6. The answers reach the server (300 ms after the last change).
    const api = apiAs(await sessionCookie(context));
    const urlOf = (n: number) => `${SHOP}${PRODUCTS[n - 1]!.path}`;
    type Stored = { variants?: Record<string, { count: number; spot?: { expected: Record<string, string>; fromProduct?: string[] } }> } | null;
    const storedVariants = async () =>
      ((await api.sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! })).verificationSet as Stored)?.variants ?? {};
    await expect
      .poll(async () => {
        const v = await storedVariants();
        return [1, 2].every((n) => Object.keys(v[urlOf(n)]?.spot?.expected ?? {}).length === 3 && v[urlOf(n)]?.spot?.fromProduct?.length === 1);
      }, { timeout: 20_000, message: 'the checked variants were not saved' })
      .toBe(true);
    const v = await storedVariants();
    expect(v[urlOf(1)]?.count).toBe(2);
    expect(v[urlOf(2)]?.count).toBe(3);
    expect(v[urlOf(3)]?.count).toBe(0);
    expect(v[urlOf(1)]?.spot?.expected, 'product 1 checked the wrong variant').toMatchObject({ sku: 'p1-red' });

    // 7. Verify now names the variants. Read, never clicked.
    await expect.poll(() => verifyButtonOf(page).innerText(), { timeout: 20_000 }).toMatch(/ and variants · /);
    expect(await verifyButtonOf(page).isDisabled(), 'Verify is not live once the variants are checked').toBe(false);

    await page.getByRole('rowheader', { name: /^Variants/ }).scrollIntoViewIfNeeded();
    await shootViewportBothThemes(page, 'app-site-verification-variants-row');
    expect(problems, `the Variants row logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 300_000);

  // Task 7 (variants plan 3): the run page's variant counts, axis/key columns
  // and Excel link. Nothing here can be proven against a real extraction —
  // Verify and Extract are off-limits on this server (an Anthropic key is
  // present) — so the run opened here was never run: its one capture and
  // extraction are inserted directly (`seedCompletedVariantsRun`), the same
  // way `@robot/api`'s own tests seed a run. No extraction starts.
  it("the run page shows an existing run's variant counts, axis/key columns and Excel link", async () => {
    expect(projectSlug, 'there is no project to open a run on').not.toBeNull();
    expect(websiteSlug, 'there is no website to open a run on').not.toBeNull();
    problems.length = 0;
    const api = apiAs(await sessionCookie(context));
    const [project, site] = await Promise.all([
      api.projects.get.query({ projectSlug: projectSlug! }),
      api.sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! }),
    ]);
    expect(project.datasetId, 'the project has no dataset to read fields and axes from').not.toBeNull();
    const variants = await api.datasets.variants.query({ datasetId: project.datasetId! });
    const keyOf = (name: string) => variants.fields.find((f) => f.name === name)?.key;
    const colourKey = variants.axes.find((a) => a.name === 'Colour')?.key;
    const [titleKey, priceKey, ratingKey, skuKey, inStockKey] = ['Title', 'Price', 'Rating', 'SKU', 'In stock'].map(keyOf);
    for (const [name, key] of [['Title', titleKey], ['Price', priceKey], ['Rating', ratingKey], ['SKU', skuKey], ['In stock', inStockKey], ['Colour', colourKey]] as const) {
      expect(key, `no key for ${name} — the variants walk above did not set it up`).toBeTruthy();
    }

    // Three products: two with variants (2 and 3, as the Variants row above
    // confirmed), one without — the same shape `summariseVariantRows` reports
    // on. `variantsSkippedForBudget` is set here directly: nothing in this
    // run genuinely hit a budget, but the fourth count line only has a code
    // path to prove when it is above zero.
    const variantRow = (n: number, colour: string, sku: string) => ({
      [titleKey!]: `Widget ${n}`, [priceKey!]: 129.99, [ratingKey!]: 4.5, [skuKey!]: sku, [inStockKey!]: true,
      [colourKey!]: colour, _product_key: `seeded-${n}`, _variant_key: sku, _url: `${SHOP}/p/${n}`,
    });
    const rows = [
      variantRow(1, 'Red', 'p1-red'), variantRow(1, 'Blue', 'p1-blue'),
      variantRow(2, 'Black', 'p2-black'), variantRow(2, 'White', 'p2-white'), variantRow(2, 'Grey', 'p2-grey'),
      { [titleKey!]: 'Widget 3', [priceKey!]: 149.0, [ratingKey!]: 4.9, [skuKey!]: 'p3', [inStockKey!]: true, _product_key: 'seeded-3', _url: `${SHOP}/p/3` },
    ];
    const variantSummary = { variants: 5, products: 3, withoutVariants: 1, partial: 0, variantsSkippedForBudget: 2 };
    const runId = await seedCompletedVariantsRun(site.id, { rows, variantSummary });

    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}/runs/${runId}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');

    // The four count lines (spec §5.3), in order, the skipped line included
    // because this seed set it above zero.
    const main = page.locator('main');
    await expect.poll(() => main.innerText(), { timeout: 20_000 }).toContain('5 variants from 3 products');
    const text = await main.innerText();
    expect(text, 'the "without variants" count is missing').toContain('1 product without variants');
    expect(text, 'the "partial variants" count is missing').toContain('0 products with partial variants');
    expect(text, 'the skipped-for-budget count is missing').toContain('2 variant pages skipped for the budget');

    // The results sheet: the axis column and the variant key, after the
    // product fields — not merely present somewhere, but real table columns.
    expect(await page.getByRole('columnheader', { name: 'Colour' }).count(), 'no Colour column in the sheet').toBe(1);
    expect(await page.getByRole('columnheader', { name: 'Variant key' }).count(), 'no Variant key column in the sheet').toBe(1);

    // CSV, JSON and Excel: real anchors (downloadable), pointing at this run.
    for (const [label, ext] of [['Download CSV', 'csv'], ['Download JSON', 'json'], ['Download Excel', 'xlsx']] as const) {
      const link = page.getByRole('link', { name: label, exact: true });
      expect(await link.count(), `no ${label} link`).toBe(1);
      expect(await link.getAttribute('href'), `${label}'s href is not this run's ${ext} file`).toContain(`/${runId}.${ext}`);
    }

    // Final review I1: the CSV link's own href actually downloads, as the
    // signed-in throwaway — the export route now requires the session cookie
    // a plain `<a href download>` navigation carries the same way the
    // browser just did for every page in this walk.
    const csvHref = await page.getByRole('link', { name: 'Download CSV', exact: true }).getAttribute('href');
    const csvRes = await fetch(csvHref!, { headers: { cookie: await sessionCookie(context) } });
    expect(csvRes.status, `the run's CSV link did not download (${csvHref})`).toBe(200);

    expect(problems, `the seeded run page logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 60_000);

  // Drift repair (plan 2026-10-05, Task 5): the free check itself needs a
  // real browser and never runs here, and a real Verify is off-limits on this
  // server. What this run proves is the wiring around it — seeded directly
  // against the database, the way the run page's test above seeds a run —
  // on this same website, after every screenshot of it has already been
  // taken, so this never changes what those earlier screens photographed.
  it("a seeded drift check shows the website's badge, the Verification banner and a working \"Accept new location\"", async () => {
    expect(projectSlug, 'there is no project to seed a drift check on').not.toBeNull();
    expect(websiteSlug, 'there is no website to seed a drift check on').not.toBeNull();
    problems.length = 0;
    const api = apiAs(await sessionCookie(context));
    const site = await api.sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! });
    const priceKey = site.fields.find((f) => f.name === 'Price')?.key;
    expect(priceKey, 'Price has no key to seed a drift check against').toBeTruthy();
    await seedDriftCheck(site.id, priceKey!);

    // The website row's badge, on the project home.
    await page.goto(`${APP}/projects/${projectSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    const row = page.locator('tbody tr').filter({ hasText: WEBSITE_HOST });
    await expect.poll(() => row.innerText(), { timeout: 20_000 }).toContain('1 field stopped extracting');

    // The Verification tab's banner, and the moved row's repair action.
    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'input[aria-label="Listing page"]');
    const banner = page.getByRole('status').filter({ hasText: 'stopped extracting' });
    await expect.poll(() => banner.innerText(), { timeout: 20_000 }).toBe('Price stopped extracting');
    expect(await rowStatusText('Price'), 'Price does not read as verified before the repair').toContain('verified');
    const acceptMove = page.getByRole('button', { name: 'Accept new location for Price', exact: true });
    await acceptMove.waitFor({ timeout: 10_000 });

    // Clicking it keeps the value, attaches the new mark, autosaves, and the
    // field now needs a Verify (Global Constraints: "Nothing is auto-accepted").
    await acceptMove.click();
    await expect.poll(() => rowStatusText('Price'), { timeout: 20_000, message: 'Price never read as needing a new Verify' }).toContain('changed since verified');
    expect(await cellState('Price', 1), 'accepting the move lost product 1’s value').not.toBeNull();

    expect(problems, `the seeded drift check logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 60_000);

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

  it('a rename on the project Settings page reaches the server and comes back (cut-over Task 1)', async () => {
    expect(projectSlug, 'there is no project to rename').not.toBeNull();
    const renamed = `${PROJECT_NAME} renamed`;
    problems.length = 0;
    await page.goto(`${APP}/projects/${projectSlug}/settings`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');

    // `ProjectInlineRename` commits on blur, and the sidebar's project section
    // reads the same `projects.get` query — so it agreeing is the round trip,
    // not an optimistic echo.
    const nameRow = page.getByRole('textbox', { name: 'Name', exact: true });
    await nameRow.fill(renamed);
    await nameRow.blur();
    await expect.poll(() => page.locator('aside').innerText(), { timeout: 20_000 }).toContain(renamed);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    expect(
      await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(),
      'the rename did not survive the reload',
    ).toBe(renamed);

    // Back to the name the screens above are captured under.
    const again = page.getByRole('textbox', { name: 'Name', exact: true });
    await again.fill(PROJECT_NAME);
    await again.blur();
    await expect.poll(() => page.locator('aside').innerText(), { timeout: 20_000 }).toContain(PROJECT_NAME);
    expect(problems, `renaming the project logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
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

  // Honest page verdicts (2026-10-09): a wall is named as a wall, never as "no
  // product links". LAST on purpose: each wall puts the shop's host on
  // backoff, so anything after this that touched the shop would wait for it
  // (see the header).
  it('a wall is reported as a wall, in the same words everywhere', async () => {
    expect(websiteSlug, 'there is no website to paste a wall into').not.toBeNull();
    problems.length = 0;
    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'input[aria-label="Listing page"]');
    const host = new URL(SHOP).hostname;
    // Find products on a 403 Cloudflare page.
    await page.getByRole('textbox', { name: 'Listing page' }).fill(`${SHOP}/blocked`);
    await page.getByRole('button', { name: 'Find products' }).click();
    await expect
      .poll(() => page.locator('main').innerText(), { timeout: 60_000 })
      .toContain(`${host} refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.`);
    expect(await page.locator('main').innerText(), 'a wall was reported as a page with no links').not.toContain('No product links found');
    await shoot(page, 'app-site-verification-wall-refused.png', false);
    // Find products again, on another page of the same host, now backing off:
    // answered from the backoff in the first wall's words, without a browser.
    await page.getByRole('textbox', { name: 'Listing page' }).fill(`${SHOP}/captcha`);
    await page.getByRole('button', { name: 'Find products' }).click();
    await expect
      .poll(() => page.locator('main').innerText(), { timeout: 30_000 })
      .toContain(
        `${host} refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet. Waiting 2 min before trying again.`,
      );
    expect(await page.locator('main').innerText(), 'a wall was reported as a page with no links').not.toContain('No product links found');
    await shoot(page, 'app-site-verification-wall-backoff.png', false);
    expect(problems, `the Verification tab logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 240_000);
});
