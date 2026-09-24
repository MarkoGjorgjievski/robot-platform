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
// Plan 3's four screens live inside that website. The run fills in its Schema
// tab the way a customer does — three product pages typed into their popovers,
// a hint, an expected value per page — and clicks **Save pages and values**,
// which is free. It never clicks Verify, Sample, Extract or Check: every one of
// those launches a browser or a model, and a test that spends money is a test
// nobody runs. So Extract is photographed locked, Runs empty, and Settings is
// proven by a rename that goes to the server and comes back.
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppRouter } from '@robot/api/routers';

const ENABLED = process.env.RUN_UI_SMOKE === '1';
const APP = process.env.APP_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';

/** Every screen of plan 1. Each is a route a signed-in customer can reach from the sidebar. */
const ROUTES = ['/projects', '/runs', '/usage', '/settings', '/account'] as const;

/** The website this run adds. `example.com` exists to be used like this, and nothing ever fetches it. */
const WEBSITE_URL = 'https://www.example.com/';
const WEBSITE_HOST = 'www.example.com';
/** What `siteNameFromUrl` derives from that address — the dialog's prefill. */
const WEBSITE_NAME = 'Example';
/** The catalogue chip this run clicks, on the Product tab it opens on. */
const FIELD_NAME = 'Price';

/**
 * The three proof pages the Schema tab is filled in with. Same host as the
 * website, different paths, and nothing ever fetches them: `updateBinding` only
 * stores what is typed. `URL_MIN` is 3, so all three need a value.
 */
const PAGE_URLS = ['https://www.example.com/p/1', 'https://www.example.com/p/2', 'https://www.example.com/p/3'] as const;
/** `Price` is a Money field, so the expected values have to parse as amounts. */
const PAGE_VALUES = ['10.00', '20.00', '30.00'] as const;
/** The "where it is on this website" hint, which `bindingProblems` also requires. */
const FIELD_HINT = 'the price next to the buy button';

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
      expect(
        await page.getByRole('textbox', { name: `Name of ${FIELD_NAME}` }).count(),
        'the Fields screen has no row for the field this run added',
      ).toBe(1);
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
 * Plan 3's four website screens. Each carries the one thing that proves it is
 * the real screen: the grid with this run's own pages in it, the locked strip a
 * website that has never verified must show, the empty run list, and the
 * settings rows.
 *
 * Nothing here clicks a control that spends: the Verify button is read for its
 * label and left alone, and Sample / Extract / Check are never reached at all
 * (the Extract tab is inert while the schema is not green, which is the state
 * this run is honestly in).
 */
const SITE_SCREENS = [
  {
    name: 'schema',
    route: '',
    assert: async () => {
      // Step 2 is where `stepOf` lands once the project has a field, so this is
      // the grid — one row for the field, one column per proof page.
      expect(await page.locator('tbody tr').count(), 'the grid has no row for the field').toBe(1);
      for (const [i, url] of PAGE_URLS.entries()) {
        expect(
          await page.getByRole('textbox', { name: `${FIELD_NAME} on page ${i + 1}` }).inputValue(),
          `page ${i + 1} lost its expected value`,
        ).toBe(PAGE_VALUES[i]);
        expect(await page.locator('thead').innerText(), `page ${i + 1}'s column head is missing`).toContain(new URL(url).pathname);
      }
      // Saved a moment ago and untouched since: the button says so rather than
      // offering a save that would write the same rows again.
      const save = page.getByRole('button', { name: 'Save pages and values' });
      expect(await save.isDisabled(), 'Save pages and values is live on an unchanged grid').toBe(true);
      expect(await page.locator('main').innerText(), 'the strip does not say why Save is off').toContain(
        'Nothing has changed since the last save',
      );
      // Read, never pressed — a verification is the one thing on this screen
      // that costs money.
      expect(await page.getByRole('button', { name: /^Verify/ }).count(), 'the Verify button is missing').toBe(1);
    },
  },
  {
    name: 'extract',
    route: '/extract',
    assert: async () => {
      // Nothing has been verified, so this is the tab's true state.
      const main = await page.locator('main').innerText();
      expect(main, 'the Extract tab is not locked on an unverified website').toContain('Extraction is locked');
      expect(main, 'the locked strip offers no way back to the Schema tab').toContain('Go to the Schema tab');
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
const shoot = async (p: Page, file: string) => {
  await p.mouse.move(1435, 895);
  await p.screenshot({ path: path.join(SCREENS, file), fullPage: true, animations: 'disabled' });
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

  it('a website added through the dialog appears on the project home', async () => {
    expect(projectSlug, 'there is no project to add a website to').not.toBeNull();
    problems.length = 0;
    await page.goto(`${APP}/projects/${projectSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');

    // `example.com` on purpose: it is the one address that exists to be used in
    // a test, and nothing here ever fetches it — the row is made from the URL.
    // The trigger and the dialog's submit share the name "Add website", so the
    // submit is asked for inside the dialog.
    await page.getByRole('button', { name: 'Add website' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Address').fill(WEBSITE_URL);
    // The name is derived from the address, so the prefill is what proves the
    // form is live before anything is submitted.
    await expect.poll(() => dialog.getByLabel('Name').inputValue(), { timeout: 10_000 }).toBe(WEBSITE_NAME);
    await dialog.getByRole('button', { name: 'Add website' }).click();

    await page.locator('tbody tr').filter({ hasText: WEBSITE_HOST }).first().waitFor({ timeout: 20_000 });
    expect(problems, `adding a website logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);

    // The slug the plan 3 screens are addressed by, read back through the same
    // session that made it rather than derived from the name by hand.
    const project = await apiAs(await sessionCookie(context)).projects.get.query({ projectSlug: projectSlug! });
    websiteSlug = project.websites.find((w) => w.name === WEBSITE_NAME)?.slug ?? null;
    expect(websiteSlug, 'the new website is not in projects.get').not.toBeNull();
  }, 120_000);

  it('a field picked from the catalogue appears in the list', async () => {
    expect(projectSlug, 'there is no project to add a field to').not.toBeNull();
    problems.length = 0;
    await page.goto(`${APP}/projects/${projectSlug}/fields`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'main');

    // A chip carries its type beside its name, so the accessible name is
    // "Price Money" — which is also what tells it apart from "Was price" and
    // "Unit price".
    await page.getByRole('button', { name: `${FIELD_NAME} Money`, exact: true }).click();
    await page.getByRole('textbox', { name: `Name of ${FIELD_NAME}` }).waitFor({ timeout: 20_000 });
    expect(problems, `adding a field logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
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

  it("the Schema tab's step 1 shows the project's fields and sends edits to the project", async () => {
    expect(websiteSlug, 'there is no website to open').not.toBeNull();
    problems.length = 0;
    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}?step=fields`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await waitForHydration(page, 'main');
    await page.waitForTimeout(1200);

    // Step 1 is a list, not a form: a field belongs to the project, so the one
    // control here is the way to the surface that owns it.
    const main = await page.locator('main').innerText();
    expect(main, 'step 1 does not list the project\'s field').toContain(FIELD_NAME);
    expect(main, 'step 1 offers no way to the project\'s Fields screen').toContain('Edit fields');
    // The list is the panel's only content: one line per field, and nothing in
    // it can be typed into. (The one input `main` does hold is the website's own
    // name, in the title row the layout owns.)
    expect(await page.locator('main ul li').count(), 'step 1 does not list one line per field').toBe(1);
    expect(await page.locator('main ul input, main ul button').count(), 'step 1 offers an editable field').toBe(0);
    expect(problems, `step 1 logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 120_000);

  it('three pages and their values save from the Schema tab', async () => {
    expect(websiteSlug, 'there is no website to fill in').not.toBeNull();
    problems.length = 0;
    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}?step=pages`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await waitForHydration(page, 'main');

    // Each proof page is typed into its own popover, the way a customer types
    // it: the pencil in the column head, the URL, "Use this page".
    for (const [i, url] of PAGE_URLS.entries()) {
      await page.getByRole('button', { name: `Edit page ${i + 1}` }).click();
      // Addressed by `data-slot` rather than by role: the popover carries two
      // inputs (this page's URL and the listing finder's), and the first is the
      // one the pencil opened for.
      const popover = page.locator('[data-slot="popover-content"]');
      await popover.locator('input').first().fill(url);
      await popover.getByRole('button', { name: 'Use this page' }).click();
      await expect
        .poll(() => page.locator('thead').innerText(), { timeout: 10_000 })
        .toContain(new URL(url).pathname);
    }

    // `bindingProblems` wants the hint as well as the three values; without it
    // Save stays off and says so.
    await page.getByRole('textbox', { name: `Where ${FIELD_NAME} is on this website` }).fill(FIELD_HINT);
    for (const [i, value] of PAGE_VALUES.entries()) {
      await page.getByRole('textbox', { name: `${FIELD_NAME} on page ${i + 1}` }).fill(value);
    }

    // Free: `updateBinding` writes rows and nothing else. Verify — the button
    // beside it — is the one that spends, and this run never touches it.
    const save = page.getByRole('button', { name: 'Save pages and values' });
    await expect.poll(() => save.isEnabled(), { timeout: 10_000 }).toBe(true);
    await save.click();
    await expect.poll(() => save.isDisabled(), { timeout: 20_000 }).toBe(true);

    // The reload is the proof: what comes back is what the server stored.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    for (const [i, value] of PAGE_VALUES.entries()) {
      expect(
        await page.getByRole('textbox', { name: `${FIELD_NAME} on page ${i + 1}` }).inputValue(),
        `page ${i + 1}'s value did not survive the reload`,
      ).toBe(value);
    }
    expect(problems, `saving pages and values logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 180_000);

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
  });

  it('renaming the organisation reaches the server and the breadcrumb', async () => {
    await page.goto(`${APP}/settings`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'aside');
    const name = `Smoke org ${Date.now()}`;
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect.poll(() => page.locator('header nav').innerText(), { timeout: 10_000 }).toContain(name);
    const cookie = await sessionCookie(context);
    expect((await apiAs(cookie!).auth.me.query()).currentOrg.name).toBe(name);
  });

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
