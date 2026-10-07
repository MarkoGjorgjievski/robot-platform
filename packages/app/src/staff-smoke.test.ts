// Staff access, end to end, in a real browser (spec 2026-10-07, Task 7).
//
// An operator (an address in the api-server's `OPS_EMAILS`) opens a customer's
// website in ops, chooses "Work on this website", confirms, and lands inside
// the customer's organisation under the staff banner. A rename goes through
// and is logged; Delete website is disabled and says why; "Back to ops" leaves.
// Then the customer signs in and reads all three entries in Settings' "Robot
// staff activity" — with real website names, which is also the HTTP-path proof
// that the logger middleware sees superjson-deserialized input.
//
// It runs only against an ISOLATED pair, never the dev servers on :4000/:3000:
// the operator address has to be in that api-server's `OPS_EMAILS`, and nobody
// should be made an operator on Marko's own server for a test. So:
//
//   # api-server on :4100, keyless, with a throwaway operator, accepting :3100
//   cd packages/api-server
//   ANTHROPIC_API_KEY= PORT=4100 OPS_EMAILS=staff-smoke-op@example.com \
//     APP_ORIGINS=http://localhost:3100 pnpm exec tsx src/index.ts
//   # the app on :3100, pointed at it
//   cd packages/app && VITE_API_URL=http://localhost:4100 pnpm exec vite dev --port 3100
//   # then, from the repo root
//   STAFF_SMOKE_OPERATOR=staff-smoke-op@example.com pnpm test:ui:staff
//
// Only throwaway `@example.com` identities sign in: the fixed operator address
// (any leftover user with it is deleted first) and a fresh customer. Both, and
// their personal orgs, are deleted afterwards — the customer's org delete
// cascades its project, website and staff log. It never clicks Verify,
// Extract, Sample or Check, and the website it creates points at a dead local
// address, so nothing is ever fetched. Screenshots (dark theme only) go to
// `docs/testing/screens/staff-*.png`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppRouter } from '@robot/api/routers';
import { deleteUserByEmail } from '@robot/api/test-helpers/identity';

const ENABLED = process.env.RUN_STAFF_SMOKE === '1';
const APP = process.env.APP_URL ?? 'http://localhost:3100';
const API = process.env.API_URL ?? 'http://localhost:4100';
const OPERATOR = (process.env.STAFF_SMOKE_OPERATOR ?? 'staff-smoke-op@example.com').toLowerCase();

const STAMP = Date.now();
const CUSTOMER = `staff-smoke-cust-${STAMP}@example.com`;
/** What `auth.signIn` names a new user's personal org: the address's local part, capitalised. */
const CUSTOMER_ORG = `Staff-smoke-cust-${STAMP}`;
const PROJECT_NAME = `Staff smoke ${STAMP}`;
const WEBSITE = 'Smoke shop';
const RENAMED = 'Smoke shop EU';
/** A dead local address: creating a website never fetches it, and nothing here asks it to. */
const WEBSITE_URL = 'http://127.0.0.1:9/';
const BLOCKED = 'Not available while working as staff';

const SCREENS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/testing/screens');

let browser: Browser;
let operatorContext: BrowserContext;
let page: Page;
let sourceId = '';
let projectSlug = '';
let siteSlug = '';

/** Page errors on the operator's page — a screen that throws is the failure that matters. */
const pageErrors: string[] = [];

const shoot = async (p: Page, file: string) => {
  await p.mouse.move(1435, 895);
  await p.screenshot({ path: path.join(SCREENS, file), fullPage: false, animations: 'disabled' });
};

function apiAs(cookie: string) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${API}/trpc`, transformer: superjson, headers: () => ({ cookie }) })],
  });
}

/** `auth.signIn` over HTTP, the way the login form posts it; returns the session cookie. */
async function signInOverHttp(email: string): Promise<string> {
  const res = await fetch(`${API}/trpc/auth.signIn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(superjson.serialize({ email, password: 'smoke' })),
  });
  if (!res.ok) throw new Error(`auth.signIn for ${email} answered ${res.status}: ${await res.text()}`);
  const session = res.headers.getSetCookie().find((c) => c.startsWith('robot_session='));
  if (!session) throw new Error('auth.signIn set no robot_session cookie');
  return session.split(';')[0]!;
}

/** See routes-smoke.test.ts: typing before hydration posts empty strings. */
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

/** The login form, filled and submitted; returns once the app has left `/login`. */
async function signInThroughTheForm(p: Page, email: string) {
  await p.goto(`${APP}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
  await waitForHydration(p, '#email');
  await p.locator('#email').fill(email);
  await p.locator('#password').fill('smoke');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await p.waitForLoadState('networkidle');
}

const theme = (p: Page) => p.evaluate(() => document.documentElement.dataset.theme);
const banner = (p: Page) => p.getByRole('status').filter({ hasText: 'Working as Robot staff in' });

async function cleanup() {
  for (const email of [CUSTOMER, OPERATOR]) {
    await deleteUserByEmail(email).catch((err) => console.error(`[staff-smoke] could not delete ${email}:`, err));
  }
}

beforeAll(async () => {
  if (!ENABLED) return;
  expect(OPERATOR.endsWith('@example.com'), 'STAFF_SMOKE_OPERATOR must be a throwaway @example.com address').toBe(true);
  for (const [label, url] of [['app', `${APP}/login`], ['api-server', `${API}/healthz`]] as const) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) throw new Error(`${label} is not responding at ${url}. Start the isolated pair first (see the top of this file).`);
  }
  // The operator address is fixed, so a run that died half-way left it behind.
  await deleteUserByEmail(OPERATOR);
  mkdirSync(SCREENS, { recursive: true });

  // 1. The customer, their project and a website — over the API, no browser,
  //    no Verify, no Extract.
  const customer = apiAs(await signInOverHttp(CUSTOMER));
  const project = await customer.projects.create.mutate({ name: PROJECT_NAME });
  // Ops lists only websites with a customer schema, so the project needs a field first.
  await customer.datasets.addField.mutate({ datasetId: project.datasetId, name: 'Title', type: 'text' });
  const site = await customer.sources.createInProject.mutate({ projectSlug: project.slug, name: WEBSITE, url: WEBSITE_URL });
  sourceId = site.sourceId;
  projectSlug = site.projectSlug;
  siteSlug = site.sourceSlug;

  browser = await chromium.launch({ headless: true });
  operatorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await operatorContext.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
}, 120_000);

afterAll(async () => {
  if (!ENABLED) return;
  await browser?.close();
  await cleanup();
});

describe.skipIf(!ENABLED)('staff access', () => {
  it('an operator works on a customer website as staff, and the customer sees what they did', async () => {
    // 2. The operator, in ops, on the customer's website.
    await signInThroughTheForm(page, OPERATOR);
    await page.goto(`${APP}/ops/websites/${sourceId}`, { waitUntil: 'networkidle', timeout: 30_000 });
    expect(await theme(page), 'the operator is not in the dark theme').toBe('dark');
    const work = page.getByRole('button', { name: 'Work on this website' });
    await work.waitFor({ timeout: 20_000 });
    await waitForHydration(page, 'main');
    await shoot(page, 'staff-ops-website.png');

    await work.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 10_000 });
    expect(await dialog.getByRole('heading').first().innerText()).toBe(`Work on ${WEBSITE} as staff?`);
    expect(await dialog.innerText()).toContain(
      `You'll act inside ${CUSTOMER_ORG}'s organisation. Deleting things and managing the organisation are blocked. Everything you change is recorded and shown to ${CUSTOMER_ORG}.`,
    );
    expect(await dialog.getByRole('button', { name: 'Cancel' }).count()).toBe(1);
    await shoot(page, 'staff-confirm.png');
    await dialog.getByRole('button', { name: 'Start working' }).click();

    // 3. Inside the customer's organisation: the banner, and no org switcher.
    await page.waitForURL(`${APP}/projects/${projectSlug}/sites/${siteSlug}`, { timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    await banner(page).waitFor({ timeout: 20_000 });
    expect((await banner(page).innerText()).trim()).toContain(`Working as Robot staff in ${CUSTOMER_ORG}`);
    expect(await banner(page).getByRole('button', { name: 'Back to ops' }).count()).toBe(1);
    // The switcher is a menu button carrying the org's name; in staff mode the
    // org's name is plain text instead.
    expect(await page.locator('aside').first().innerText()).toContain(CUSTOMER_ORG);
    expect(await page.locator('aside button').filter({ hasText: CUSTOMER_ORG }).count(), 'the org switcher is still there').toBe(0);
    await shoot(page, 'staff-banner.png');

    // 4. An allowed edit: rename the website from its Settings tab.
    await page.goto(`${APP}/projects/${projectSlug}/sites/${siteSlug}/settings`, { waitUntil: 'networkidle', timeout: 30_000 });
    const nameBox = page.getByRole('textbox', { name: 'Name', exact: true });
    await nameBox.waitFor({ timeout: 20_000 });
    await waitForHydration(page, 'input[aria-label="Name"]');
    expect(await nameBox.inputValue()).toBe(WEBSITE);
    await nameBox.fill(RENAMED);
    const renamed = page.waitForResponse((r) => r.url().includes('sources.rename'), { timeout: 15_000 });
    await nameBox.press('Tab');
    expect((await renamed).ok(), 'sources.rename failed in staff mode').toBe(true);
    await expect
      .poll(() => page.getByRole('textbox', { name: 'Website name' }).inputValue(), { timeout: 10_000, message: 'the page title did not take the new name' })
      .toBe(RENAMED);

    // 5. Blocked: Delete website is disabled, and says why within a line of it.
    const del = page.getByRole('button', { name: 'Delete website' });
    expect(await del.isDisabled(), 'Delete website is enabled in staff mode').toBe(true);
    const dangerRow = page.locator('div').filter({ has: del }).filter({ hasText: BLOCKED }).last();
    expect(await dangerRow.count(), `"${BLOCKED}" is not beside Delete website`).toBe(1);
    await shoot(page, 'staff-settings-blocked.png');

    // 6. Back to ops: the banner goes with the staff session.
    await banner(page).getByRole('button', { name: 'Back to ops' }).click();
    await page.waitForURL(`${APP}/ops`, { timeout: 30_000 });
    // The list loads after the navigation settles; wait for it, not for network idle.
    await page.getByRole('heading', { name: 'All websites' }).waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: /^All\s+\d+$/ }).waitFor({ timeout: 20_000 });
    expect(await banner(page).count(), 'the staff banner outlived Back to ops').toBe(0);
    // Ops lists every org in the database. Narrow it to this run's customer
    // before the screenshot, so no real customer's name ends up in docs/.
    await page.getByRole('button', { name: /^All\s+\d+$/ }).click();
    await page.locator('#ops-search').fill(CUSTOMER_ORG);
    const rows = page.locator('tbody tr');
    await expect.poll(() => rows.count(), { timeout: 10_000, message: 'the ops search did not narrow to the throwaway customer' }).toBe(1);
    expect(await rows.first().innerText()).toContain(CUSTOMER_ORG);
    await shoot(page, 'staff-back-to-ops.png');
    expect(pageErrors, `the operator's pages threw:\n  ${pageErrors.join('\n  ')}`).toEqual([]);

    // 7. The customer, in a fresh browser, reads it all in Settings.
    const customerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const cp = await customerContext.newPage();
      await signInThroughTheForm(cp, CUSTOMER);
      await cp.goto(`${APP}/settings`, { waitUntil: 'networkidle', timeout: 30_000 });
      expect(await theme(cp), 'the customer is not in the dark theme').toBe('dark');
      const panel = cp.locator('section').filter({ has: cp.getByRole('heading', { name: 'Robot staff activity' }) });
      await panel.waitFor({ timeout: 20_000 });
      await expect.poll(() => panel.innerText(), { timeout: 15_000 }).toContain('Started working as staff');
      const text = await panel.innerText();
      expect(text).toContain(`Renamed website ${WEBSITE} to ${RENAMED}`);
      expect(text).toContain('Stopped working as staff');
      await panel.scrollIntoViewIfNeeded();
      await shoot(cp, 'staff-customer-settings.png');
    } finally {
      await customerContext.close();
    }
  }, 240_000);
});
