// A fresh customer's first run, end to end, on real websites (spec 2026-10-25 first run).
//
// The route smoke stops before Verify and Extract because they can spend. Keyless they are free, so this
// walks a brand-new customer the whole way: sign in, a project, two fields, a website on a real listing
// page, Find products, Accept all agreed, Verify, the Extract tab (pages, sample, a 10-item run), the
// run's CSV and JSON, and the project's Output. One real Chromium drives the real UI by roles and labels.
//
// It runs only against the ISOLATED pair, never `pnpm dev:all` (the worker loads real websites, and a
// paid key or Jev there would spend):
//
//   # api-server on :4100, keyless, on its own queue
//   cd packages/api-server
//   ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= SMTP_URL= WEBSITE_CHECKS=off JOB_QUEUE=isolated-4100 \
//     PORT=4100 APP_ORIGINS=http://localhost:3100 npx tsx src/index.ts
//   # its worker; stop it by creating the stop file
//   cd packages/worker
//   ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= SMTP_URL= WEBSITE_CHECKS=off RECURRING_RUNS=off \
//     JOB_QUEUE=isolated-4100 WORKER_STOP_FILE=<a temp file> npx tsx src/index.ts
//   # the app on :3100
//   cd packages/app && VITE_API_URL=http://localhost:4100 npx vite dev --port 3100
//   # then, from packages/app
//   RUN_FIRST_RUN=1 APP_URL=http://localhost:3100 API_URL=http://localhost:4100 npx vitest run src/first-run.test.ts
//
// `FIRST_RUN_SITES` overrides the sites: a JSON array of `{ "site": "name", "listing": "https://…" }`.
// Each site runs as its own throwaway `first-run-<site>-<stamp>@example.com`; a failed step stops that site,
// records the step, its screenshot, the visible text and the last API answers, and the next site runs.
// Afterwards the user and its personal org are deleted through `deleteUserByEmail`'s guarded delete (never
// the seeded `default` org). The report is `docs/testing/results/2026-10-25-first-run/first-run.json` plus a
// short `first-run.md`, and a screenshot per step, `<site>-<n>.png`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppRouter } from '@robot/api/routers';
import { deleteUserByEmail } from '@robot/api/test-helpers/identity';
import { parseCsv } from './lib/site/csv';
import { listingBarStart } from './lib/site/listing-bar-view';

const ENABLED = process.env.RUN_FIRST_RUN === '1';
const APP = process.env.APP_URL ?? 'http://localhost:3100';
const API = process.env.API_URL ?? 'http://localhost:4100';

type Site = { site: string; listing: string };

const DEFAULT_SITES: Site[] = [
  // Shopify: a women's leggings collection.
  { site: 'gymshark', listing: 'https://www.gymshark.com/collections/leggings/womens' },
  // A headphones category (`/collections/headphones` redirects here).
  { site: 'skullcandy', listing: 'https://www.skullcandy.com/collections/wireless-wired-bluetooth-headphones' },
  // The campaign-1/2 control listing.
  { site: 'ikea', listing: 'https://www.ikea.com/my/en/cat/sofas-fu003/' },
];

const SITES: Site[] = process.env.FIRST_RUN_SITES ? (JSON.parse(process.env.FIRST_RUN_SITES) as Site[]) : DEFAULT_SITES;

const STAMP = Date.now();
export const firstRunEmail = (site: string) => `first-run-${site.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${STAMP}@example.com`;

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/testing/results/2026-10-25-first-run');

/** Per-step timeouts (spec §2 "Report"): Verify 6 minutes, the run 8 minutes. */
const T = {
  ui: 30_000,
  reach: 90_000,
  find: 120_000,
  captures: 300_000,
  verify: 360_000,
  sample: 360_000,
  run: 480_000,
};

type StepLog = { n: number; name: string; ok: boolean; ms: number; screenshot: string | null; detail?: string };
type Trip = { step: number; name: string; error: string; screenshot: string | null; visibleText: string; lastAnswers: string[]; problems: string[] };
type SiteLog = { site: string; listing: string; email: string; steps: StepLog[]; trip: Trip | null; cleanup: string | null; facts: Record<string, unknown> };

const report: { startedAt: string; app: string; api: string; sites: SiteLog[] } = {
  startedAt: new Date().toISOString(),
  app: APP,
  api: API,
  sites: [],
};

let browser: Browser;

function apiAs(cookie: string) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${API}/trpc`, transformer: superjson, headers: () => ({ cookie }) })],
  });
}

async function sessionCookie(ctx: BrowserContext): Promise<string> {
  const session = (await ctx.cookies(API)).find((c) => c.name === 'robot_session');
  if (!session) throw new Error('no robot_session cookie — the sign-in did not take');
  return `${session.name}=${session.value}`;
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

const mainText = async (p: Page) => ((await p.locator('main').innerText({ timeout: 5_000 }).catch(() => '')) || (await p.locator('body').innerText().catch(() => ''))).replace(/[ \t]+\n/g, '\n');

/** Polls `fn` until it returns a truthy value, or throws `message` (with the last value) after `timeout`. */
async function until<T>(fn: () => Promise<T | null | undefined | false>, timeout: number, message: string, interval = 1000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const last = await fn();
    if (last) return last;
    if (Date.now() > end) throw new Error(`${message} (after ${Math.round(timeout / 1000)} s)`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** A verification cell's state word, from its label: "Price on product 2: suggested, 219.99" -> "suggested". */
async function cellState(p: Page, name: string, product: number): Promise<string | null> {
  const cell = p.locator(`button[aria-label^="${name} on product ${product}: "]`);
  if ((await cell.count()) !== 1) return null;
  return ((await cell.getAttribute('aria-label')) ?? '').slice(`${name} on product ${product}: `.length).split(',')[0]!;
}

async function cellLabel(p: Page, name: string, product: number): Promise<string | null> {
  const cell = p.locator(`button[aria-label^="${name} on product ${product}: "]`);
  if ((await cell.count()) !== 1) return null;
  return cell.getAttribute('aria-label');
}

async function rowStatusText(p: Page, name: string): Promise<string> {
  const row = p.getByRole('row').filter({ has: p.getByRole('rowheader', { name: new RegExp(`^${name}\\b`) }) });
  return (await row.locator('td').last().innerText({ timeout: 5_000 })).replace(/\s+/g, ' ').trim();
}

/** Our chrome without the customer's data (routes-smoke's `expectNoMoney`): a money word there is a defect. */
async function moneyInChrome(p: Page): Promise<string | null> {
  const chrome = await p.locator('main').evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('td, [role="gridcell"], [data-value], [data-cell], [data-testid="selected-value"]').forEach((n) => n.remove());
    clone.style.position = 'absolute';
    clone.style.left = '-99999px';
    document.body.appendChild(clone);
    const text = clone.innerText;
    clone.remove();
    return text;
  });
  const m = chrome.match(/\$\s?\d[^\n]{0,30}|\bfree\b[^\n]{0,30}|\bup to ~?\$[^\n]{0,20}/i);
  return m ? m[0] : null;
}

/** A price cell is numeric: a JSON number, or a plain decimal string. */
const numeric = (v: unknown) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()));
const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const keyOf = (keys: string[], name: string) => keys.find((k) => k.toLowerCase() === name.toLowerCase()) ?? null;

async function runSite(s: Site): Promise<SiteLog> {
  const email = firstRunEmail(s.site);
  const log: SiteLog = { site: s.site, listing: s.listing, email, steps: [], trip: null, cleanup: null, facts: {} };
  const answers: string[] = [];
  const problems: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on('response', (r) => {
    if (!r.url().startsWith(API)) return;
    const u = new URL(r.url());
    const line = `${r.status()} ${r.request().method()} ${u.pathname}`;
    if (r.status() >= 400) {
      void r.text().then(
        (t) => answers.push(`${line} ${t.slice(0, 400)}`),
        () => answers.push(line),
      );
    } else answers.push(line);
    if (answers.length > 30) answers.splice(0, answers.length - 30);
  });

  let projectSlug = '';
  let siteSlug = '';
  let sourceId = '';
  let runId = '';

  const shoot = async (n: number | string) => {
    const file = `${s.site}-${n}.png`;
    await page.mouse.move(1435, 895).catch(() => {});
    await page.screenshot({ path: path.join(OUT, file), fullPage: true, animations: 'disabled' }).catch(() => {});
    return file;
  };

  const step = async (n: number, name: string, body: () => Promise<string | void>) => {
    const t0 = Date.now();
    try {
      const detail = await body();
      const screenshot = await shoot(n);
      log.steps.push({ n, name, ok: true, ms: Date.now() - t0, screenshot, ...(detail ? { detail } : {}) });
      console.log(`[first-run] ${s.site} ${n}. ${name}: ok (${Math.round((Date.now() - t0) / 1000)} s)${detail ? ` — ${detail}` : ''}`);
    } catch (err) {
      const screenshot = await shoot(`${n}-trip`);
      const error = err instanceof Error ? err.message : String(err);
      log.steps.push({ n, name, ok: false, ms: Date.now() - t0, screenshot, detail: error });
      log.trip = { step: n, name, error, screenshot, visibleText: (await mainText(page)).slice(0, 4000), lastAnswers: [...answers], problems: [...problems] };
      console.log(`[first-run] ${s.site} ${n}. ${name}: TRIP — ${error}`);
      throw err;
    }
  };

  try {
    await deleteUserByEmail(email);

    await step(1, 'Sign in and land on /projects with its empty state', async () => {
      await page.goto(`${APP}/login`, { waitUntil: 'networkidle', timeout: T.ui });
      await waitForHydration(page, '#email');
      await page.locator('#email').fill(email);
      await page.locator('#password').fill('first-run');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL(`${APP}/projects`, { timeout: T.ui });
      await page.getByText('No projects yet.', { exact: false }).waitFor({ timeout: T.ui });
    });

    await step(2, `New project "First run ${s.site}"`, async () => {
      await waitForHydration(page, 'main');
      await page.getByRole('button', { name: 'New project' }).first().click();
      await page.getByLabel('Name').fill(`First run ${s.site}`);
      await page.getByRole('button', { name: 'Create project' }).click();
      await page.getByRole('cell', { name: `First run ${s.site}`, exact: true }).waitFor({ timeout: T.ui });
      const rows = await apiAs(await sessionCookie(context)).projects.list.query();
      projectSlug = rows.find((r) => r.name === `First run ${s.site}`)?.slug ?? '';
      if (!projectSlug) throw new Error('the new project is not in projects.list');
      return `project ${projectSlug}`;
    });

    await step(3, 'Fields: Title (Text) and Price (Money) from the catalogue', async () => {
      await page.goto(`${APP}/projects/${projectSlug}/fields`, { waitUntil: 'networkidle', timeout: T.ui });
      await waitForHydration(page, 'main');
      for (const f of [{ name: 'Title', type: 'Text' }, { name: 'Price', type: 'Money' }]) {
        await page.getByRole('button', { name: `${f.name} ${f.type}`, exact: true }).click();
        await page.getByRole('textbox', { name: `Name of ${f.name}` }).waitFor({ timeout: T.ui });
      }
    });

    await step(4, 'Add website with the listing page; land on Verification; the reachability line', async () => {
      await page.goto(`${APP}/projects/${projectSlug}`, { waitUntil: 'networkidle', timeout: T.ui });
      await waitForHydration(page, 'main');
      await page.getByRole('button', { name: 'Add website' }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Address').fill(s.listing);
      await until(async () => (await dialog.getByLabel('Name').inputValue()) !== '', 10_000, 'the dialog never prefilled a name');
      const name = await dialog.getByLabel('Name').inputValue();
      await dialog.getByRole('button', { name: 'Add website' }).click();
      await page.waitForURL(new RegExp(`/projects/${projectSlug}/sites/[^/?]+$`), { timeout: T.ui });
      siteSlug = new URL(page.url()).pathname.split('/').pop()!;
      const site = await apiAs(await sessionCookie(context)).sources.get.query({ projectSlug, sourceSlug: siteSlug });
      sourceId = site.id;
      await waitForHydration(page, 'input[aria-label="Listing page"]');
      const line = await until(
        async () => {
          const t = await mainText(page);
          const m = t.match(/This website opens normally\.|[^\n]*(?:blocked|could not|did not|refused|wall|human check|Waiting)[^\n]*/i);
          return m ? m[0] : null;
        },
        T.reach,
        'no reachability line under the listing bar',
      );
      if (line !== 'This website opens normally.') throw new Error(`the reachability line reads: ${line}`);
      return `website "${name}" (${siteSlug}); ${line}`;
    });

    await step(5, 'Find products: "N products found" (N ≥ 3) and three proof pages ready', async () => {
      const box = page.getByRole('textbox', { name: 'Listing page' });
      // D5: the address typed in Add website is already in the bar when it can be a listing (a category page);
      // a FIRST_RUN_SITES address that cannot (a front page) is typed here as before.
      const expected = listingBarStart('', s.listing);
      const prefilled = await box.inputValue();
      if (prefilled !== expected) throw new Error(`the listing bar should start with "${expected}"; it reads "${prefilled}"`);
      if (!expected) await box.fill(s.listing);
      await page.getByRole('button', { name: 'Find products' }).click();
      const found = await until(
        async () => {
          const t = await mainText(page);
          const m = t.match(/(\d+) products? found[^\n]*/);
          if (m) return { n: Number(m[1]), line: m[0] };
          const alert = await page.locator('main [role="alert"]').allInnerTexts().catch(() => []);
          if (alert.some((a) => a.trim())) return { n: 0, line: alert.join(' | ') };
          if (/No products found on this page\./.test(t)) return { n: 0, line: 'No products found on this page.' };
          return null;
        },
        T.find,
        'Find products never answered',
      );
      log.facts.found = found.line;
      if (found.n < 3) throw new Error(`Find products said: ${found.line}`);
      const ready = await until(
        async () => {
          const n = await page.getByText('ready', { exact: true }).count();
          return n >= 3 ? n : null;
        },
        T.captures,
        'three proof pages never read "ready"',
        2000,
      ).catch(async (err) => {
        const n = await page.getByText('ready', { exact: true }).count();
        throw new Error(`${(err as Error).message}; ${n} ready`);
      });
      const site = await apiAs(await sessionCookie(context)).sources.get.query({ projectSlug, sourceSlug: siteSlug });
      log.facts.proofPages = ((site.verificationSet ?? null) as { urls?: string[] } | null)?.urls ?? [];
      return `${found.line}; ${ready} ready`;
    });

    await step(6, 'Accept all agreed: Title and Price agreed and accepted on all three proof pages', async () => {
      const rows: Record<string, string> = {};
      for (const f of ['Title', 'Price']) {
        rows[f] = await until(
          async () => {
            const t = await rowStatusText(page, f).catch(() => '');
            return t && !/checking|reading/i.test(t) ? t : null;
          },
          60_000,
          `the ${f} row never said what it needs`,
        );
      }
      const cells: Record<string, string | null> = {};
      for (const f of ['Title', 'Price']) for (let i = 1; i <= 3; i++) cells[`${f} ${i}`] = await cellLabel(page, f, i);
      log.facts.beforeAccept = { rows, cells };
      const notAgreed = Object.entries(rows).filter(([, t]) => !/^agreed\b/.test(t));
      if (notAgreed.length) throw new Error(`not agreed: ${notAgreed.map(([f, t]) => `${f} reads "${t}"`).join('; ')}`);
      await page.getByRole('button', { name: /^Accept all agreed \(\d+\)$/ }).click();
      const missing: string[] = [];
      for (const f of ['Title', 'Price']) {
        for (let i = 1; i <= 3; i++) {
          const ok = await until(async () => (await cellState(page, f, i)) === 'accepted', 10_000, '').then(() => true, () => false);
          if (!ok) missing.push(`${f} on product ${i}: ${await cellLabel(page, f, i)}`);
        }
      }
      if (missing.length) throw new Error(`not accepted after Accept all agreed: ${missing.join('; ')}`);
      await until(async () => (await page.getByText('saved', { exact: true }).count()) === 1, 20_000, 'the board never read "saved"');
      return Object.entries(cells).map(([k, v]) => v ?? `${k}: none`).join(' | ');
    });

    await step(7, 'Verify: "Verify 2 fields", both fields certified, no customer-visible money', async () => {
      const verify = page.getByRole('button', { name: /^Verify/ });
      await verify.waitFor({ timeout: T.ui });
      const label = (await verify.innerText()).trim();
      if (label !== 'Verify 2 fields') throw new Error(`the Verify button reads "${label}"`);
      const money0 = await moneyInChrome(page);
      if (money0) throw new Error(`a money word before Verify: "${money0}"`);
      const api = apiAs(await sessionCookie(context));
      const before = (await api.sources.verificationStatus.query({ sourceId }))?.id ?? null;
      await verify.click();
      const t0 = Date.now();
      const status = await until(
        async () => {
          const st = await api.sources.verificationStatus.query({ sourceId }).catch(() => null);
          if (!st) return null;
          if (st.failedRun) return st;
          if (st.id === before || !st.completedAt) return null;
          return st;
        },
        T.verify,
        'Verify never finished',
        3000,
      );
      log.facts.verifySeconds = Math.round((Date.now() - t0) / 1000);
      const results = (status.results ?? {}) as Record<string, { certified?: unknown[] }>;
      log.facts.verify = {
        allPassed: status.allPassed,
        currentKeys: status.currentKeys,
        runnable: status.runnable,
        failedRun: status.failedRun,
        certified: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.certified ?? []])),
      };
      await page.getByRole('link', { name: 'Go to Extract' }).waitFor({ timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const message = await page.getByTestId('verify-message').innerText().catch(() => null);
      if (status.failedRun || !status.runnable) {
        throw new Error(`Verify ended without both fields certified: current ${JSON.stringify(status.currentKeys)}, allPassed ${status.allPassed}${status.failedRun ? `, failed run${status.failedRun.stalled ? ' (stalled)' : ''}` : ''}; bar: ${message ?? '—'}; rows: Title "${await rowStatusText(page, 'Title')}", Price "${await rowStatusText(page, 'Price')}"`);
      }
      const money = await moneyInChrome(page);
      if (money) throw new Error(`a customer sees money after Verify: "${money}"`);
      if ((await page.getByRole('link', { name: 'Go to Extract' }).count()) !== 1) throw new Error('Go to Extract is not a live link after a passing Verify');
      return `certified ${status.currentKeys.join(', ')} in ${log.facts.verifySeconds} s; Title "${await rowStatusText(page, 'Title')}", Price "${await rowStatusText(page, 'Price')}"`;
    });

    await step(8, 'Extract: listing pages, a sample, run limits 10 items / 1 page, Extract; the run reads done or partial', async () => {
      await page.getByRole('link', { name: 'Go to Extract' }).click();
      await page.waitForURL(new RegExp(`/sites/${siteSlug}/extract$`), { timeout: T.ui });
      await page.getByRole('radiogroup', { name: 'Where the products come from' }).waitFor({ timeout: T.ui });
      await waitForHydration(page, '[role="radiogroup"] button');
      const notes: string[] = [];
      // Section 1: the listing page, unless it is already saved there.
      const saved = (await page.locator('main table').filter({ hasText: 'Listing page' }).locator('tbody tr').filter({ hasText: s.listing }).count()) > 0;
      const editable = (await page.getByRole('button', { name: /^(Save pages|Save URLs)$/ }).count()) > 0 || (await page.getByRole('radio', { name: 'Listing pages' }).isEnabled());
      if (saved && !editable) {
        notes.push('listing page already saved');
      } else {
        const listingRadio = page.getByRole('radio', { name: 'Listing pages' });
        if ((await listingRadio.getAttribute('aria-checked')) !== 'true') await listingRadio.click();
        if (!saved) {
          await page.getByRole('textbox', { name: 'Listing pages to add' }).fill(s.listing);
          await page.getByRole('button', { name: 'Add', exact: true }).click();
        } else notes.push('listing page prefilled');
        await page.getByRole('button', { name: 'Save pages' }).click();
        await until(async () => (await page.getByRole('button', { name: 'Save pages' }).count()) === 0, T.ui, 'Save pages never saved');
        notes.push('pages saved');
      }
      // Section 2: the sample.
      const sample = page.getByRole('button', { name: /^Sample 3 products$|^Sample again$/ });
      await sample.waitFor({ timeout: T.ui });
      if ((await page.getByRole('button', { name: 'Sample 3 products' }).count()) === 1) {
        await page.getByRole('button', { name: 'Sample 3 products' }).click();
        const t0 = Date.now();
        await until(
          async () => {
            if ((await page.getByText('Sample first', { exact: true }).count()) > 0) return null;
            if ((await page.getByText('This sample is still running', { exact: true }).count()) > 0) return null;
            return (await page.getByRole('button', { name: 'Extract', exact: true }).isEnabled()) ? true : null;
          },
          T.sample,
          'the sample never finished (Extract still says "Sample first")',
          3000,
        ).catch(async (err) => {
          const t = await mainText(page);
          const sec = t.slice(t.indexOf('Sample'), t.indexOf('Sample') + 600);
          throw new Error(`${(err as Error).message}; section 2 reads: ${sec.replace(/\s+/g, ' ')}`);
        });
        notes.push(`sample done in ${Math.round((Date.now() - t0) / 1000)} s`);
      }
      await shoot('8a-sample');
      // Section 3: run limits, then Extract.
      await page.getByRole('combobox', { name: 'How many products' }).click();
      await page.getByRole('option', { name: 'custom' }).click();
      await page.getByRole('spinbutton', { name: 'How many products' }).fill('10');
      await page.getByRole('combobox', { name: 'How many pages' }).click();
      await page.getByRole('option', { name: 'custom' }).click();
      await page.getByRole('spinbutton', { name: 'How many pages' }).fill('1');
      await page.getByRole('spinbutton', { name: 'How many pages' }).press('Tab');
      const sentence = await page.locator('main').getByText(/^Run|safety|stop/).last().innerText().catch(() => '');
      notes.push(`limits 10/1${sentence ? ` (${sentence.replace(/\s+/g, ' ').slice(0, 160)})` : ''}`);
      const extract = page.getByRole('button', { name: 'Extract', exact: true });
      if (!(await extract.isEnabled())) {
        const reason = await extract.locator('xpath=following-sibling::span').innerText().catch(() => '—');
        throw new Error(`Extract is disabled: ${reason}`);
      }
      await extract.click();
      const open = page.getByRole('link', { name: 'Open the run' });
      await until(
        async () => {
          if ((await open.count()) === 1) return true;
          const alert = await page.locator('main [role="alert"]').allInnerTexts().catch(() => []);
          if (alert.some((a) => a.trim())) throw new Error(`Extract answered: ${alert.join(' | ')}`);
          return null;
        },
        120_000,
        'Extract never showed "Open the run"',
      );
      await open.click();
      await page.waitForURL(/\/runs\/[^/?]+$/, { timeout: T.ui });
      runId = new URL(page.url()).pathname.split('/').pop()!;
      const t0 = Date.now();
      const state = await until(
        async () => {
          const h = (await page.getByRole('heading', { name: /^Extraction/ }).innerText().catch(() => '')).replace(/\s+/g, ' ');
          if (/Done|Partial/.test(h)) return h;
          if (/Failed/.test(h)) throw new Error(`the run reads: ${h}`);
          return null;
        },
        T.run,
        'the run never read Done or Partial',
        3000,
      );
      log.facts.runSeconds = Math.round((Date.now() - t0) / 1000);
      log.facts.runId = runId;
      return `${notes.join('; ')}; run ${runId.slice(0, 8)} reads "${state}" after ${log.facts.runSeconds} s`;
    });

    await step(9, 'Run page: download the CSV and JSON; ≥ 5 rows, Title and Price on every row, prices numeric', async () => {
      const files: Record<string, string> = {};
      for (const fmt of ['CSV', 'JSON'] as const) {
        const link = page.getByRole('link', { name: `Download ${fmt}`, exact: true });
        await link.waitFor({ timeout: T.ui });
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: T.ui }), link.click()]);
        const file = path.join(OUT, `${s.site}-run.${fmt.toLowerCase()}`);
        await download.saveAs(file);
        files[fmt] = file;
      }
      const csv = parseCsv(readFileSync(files.CSV!, 'utf8').replace(/^﻿/, ''));
      const header = csv[0] ?? [];
      const csvRows = csv.slice(1);
      const json = JSON.parse(readFileSync(files.JSON!, 'utf8')) as { rows?: Record<string, unknown>[]; fields?: string[] };
      const rows = json.rows ?? [];
      const keys = Object.keys(rows[0] ?? {});
      const tk = keyOf(keys, 'title') ?? keyOf(keys, 'Title');
      const pk = keyOf(keys, 'price') ?? keyOf(keys, 'Price');
      log.facts.download = { csvHeader: header, csvRows: csvRows.length, jsonRows: rows.length, jsonKeys: keys, sample: rows.slice(0, 3) };
      const problemsFound: string[] = [];
      if (csvRows.length < 5) problemsFound.push(`the CSV has ${csvRows.length} rows`);
      if (rows.length < 5) problemsFound.push(`the JSON has ${rows.length} rows`);
      if (!tk || !pk) problemsFound.push(`the JSON rows have no Title/Price keys: ${keys.join(', ')}`);
      else {
        const noTitle = rows.filter((r) => blank(r[tk])).length;
        const noPrice = rows.filter((r) => blank(r[pk])).length;
        const notNumeric = rows.filter((r) => !blank(r[pk]) && !numeric(r[pk])).map((r) => JSON.stringify(r[pk]));
        if (noTitle) problemsFound.push(`${noTitle} of ${rows.length} rows have no Title`);
        if (noPrice) problemsFound.push(`${noPrice} of ${rows.length} rows have no Price`);
        if (notNumeric.length) problemsFound.push(`non-numeric prices: ${notNumeric.slice(0, 5).join(', ')}`);
      }
      const ci = header.findIndex((h) => /^title$/i.test(h));
      const cp = header.findIndex((h) => /^price$/i.test(h));
      if (ci < 0 || cp < 0) problemsFound.push(`the CSV header has no Title/Price: ${header.join(', ')}`);
      else if (csvRows.some((r) => !r[ci]?.trim() || !r[cp]?.trim())) problemsFound.push('a CSV row has an empty Title or Price');
      if (problemsFound.length) throw new Error(problemsFound.join('; '));
      return `CSV ${csvRows.length} rows (${header.join(', ')}); JSON ${rows.length} rows`;
    });

    await step(10, 'Project Output shows the rows', async () => {
      await page.goto(`${APP}/projects/${projectSlug}/output`, { waitUntil: 'networkidle', timeout: T.ui });
      const rows = await until(async () => {
        const n = await page.locator('main table tbody tr').count();
        return n > 0 ? n : null;
      }, T.ui, 'the Output page shows no rows').catch(async (err) => {
        throw new Error(`${(err as Error).message}: ${(await mainText(page)).slice(0, 300)}`);
      });
      const expected = (log.facts.download as { jsonRows: number }).jsonRows;
      if (rows < Math.min(expected, 5)) throw new Error(`Output shows ${rows} rows; the run downloaded ${expected}`);
      return `${rows} rows on Output`;
    });
  } catch {
    // Recorded in `log.trip` by `step`; the next site runs.
  } finally {
    await context.close().catch(() => {});
    try {
      await deleteUserByEmail(email);
      log.cleanup = 'deleted';
    } catch (err) {
      log.cleanup = `could not delete: ${err instanceof Error ? err.message : String(err)}`;
    }
    log.steps.push({ n: 11, name: 'Cleanup: the throwaway org and user deleted (guarded delete)', ok: log.cleanup === 'deleted', ms: 0, screenshot: null, detail: log.cleanup });
  }
  return log;
}

function writeReport() {
  writeFileSync(path.join(OUT, 'first-run.json'), JSON.stringify(report, null, 2) + '\n');
  const lines = [`# First run — ${report.startedAt}`, '', `App ${APP}, api ${API}.`, ''];
  for (const s of report.sites) {
    const passed = s.steps.filter((x) => x.ok && x.n <= 10).length;
    lines.push(`## ${s.site} — ${s.trip ? `tripped at step ${s.trip.step}` : 'passed'} (${passed} of 10 steps)`, '', `Listing: ${s.listing}`, '');
    for (const x of s.steps) lines.push(`${x.n}. ${x.ok ? 'ok' : 'TRIP'} — ${x.name}${x.detail ? `: ${x.detail}` : ''}${x.ms ? ` (${Math.round(x.ms / 1000)} s)` : ''}`);
    lines.push('');
  }
  writeFileSync(path.join(OUT, 'first-run.md'), lines.join('\n'));
}

beforeAll(async () => {
  if (!ENABLED) return;
  for (const s of SITES) expect(firstRunEmail(s.site).endsWith('@example.com')).toBe(true);
  for (const [label, url] of [['app', `${APP}/login`], ['api-server', `${API}/healthz`]] as const) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) throw new Error(`${label} is not responding at ${url}. Start the isolated pair first (see the top of this file).`);
  }
  mkdirSync(OUT, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  if (!ENABLED) return;
  await browser?.close();
  writeReport();
});

describe.skipIf(!ENABLED)('a fresh customer, first run', () => {
  for (const s of SITES) {
    it(`${s.site}: sign-in to downloaded rows`, async () => {
      const log = await runSite(s);
      report.sites.push(log);
      writeReport();
      expect(log.trip, log.trip ? `${s.site} tripped at step ${log.trip.step} (${log.trip.name}): ${log.trip.error}` : '').toBeNull();
    }, 45 * 60_000);
  }
});
