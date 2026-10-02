// A free live check of variants verification (spec 2026-10-01 §4, plans 1–2)
// on a real shop, step by step, as a throwaway identity.
//
// Setup and every answer happen in the everyday app on :3000 (talking to :4000):
// captures, detection, suggestions and answers never use a model. Verify is
// NEVER clicked in the app — that button talks to the keyed :4000. Instead the
// `verify` phase calls `sources.verifyEstimate` on a SECOND, keyless
// api-server, refuses to go on unless it answers `aiAvailable: false` and
// `upperBoundUsd: 0`, then calls `sources.verify` there with the browser's own
// session cookie and polls `sources.verificationStatus` until it completes.
// The `after` phase reloads the tab on :3000 and reads the Variants row and
// Go to Extract.
//
//   cd packages/api-server && ANTHROPIC_API_KEY= PORT=4100 pnpm exec tsx src/index.ts
//
// Run from packages/browser so `playwright` resolves:
//   cp docs/testing/ui-check-app-variants.mts packages/browser/src/__variants-check.mts
//   cd packages/browser && pnpm exec tsx src/__variants-check.mts <phase> [options] ; rm src/__variants-check.mts
//
// Phases, in order (state — the session and slugs — lives in `$CHECK_STATE_DIR`, default `./.variants-check`):
//   signin                                   sign up check-<ts>@example.com through /login
//   setup --tag A --site <url> --listing <url> [--fields "Title Text,Price Money"]
//                                            project (variants: one row per variant), fields, website, Find products, screenshots, Accept all agreed
//     (or --products <url,url,url> instead of --listing, when the listing heuristic picks the wrong links)
//   replace --tag A --n 1 --url <url>        drop product n and paste another page (e.g. a redirect's target)
//   delete-field --tag A --field Title       drop a field the shop's page data names wrongly; Accept all agreed
//   accept-cell --tag A [--cells "Price:1"] [--row 'all agreed \(2\)']   a cell's ✓ / a row's Accept
//   inspect --tag A [--expand 1]             print the table, the Variants step / row, the Verify label; screenshot
//   step --tag A --method list|links         confirm the Variants step with that method
//   counts --tag A                           confirm every product's count (or "No variants")
//   spot --tag A [--from-product "Price:1"]  expand the row; accept every suggestion of each checked variant
//                                            (links: wait for each checked page's screenshot)
//   verify --tag A [--only-keys ""]          keyless Verify over HTTP on :4100 (refuses unless free); no
//                                            --only-keys = the app's first run, "" = its variants-only run
//   after --tag A                            reload; read the Variants row and Go to Extract; screenshot
//   cleanup --tag A                          delete the throwaway project
//
// It never clicks Verify, Extract, Sample or Check, and never calls :4000's verify.
import { chromium, type Page } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const APP = process.env.APP_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';
const KEYLESS = process.env.KEYLESS_API_URL ?? 'http://localhost:4100';
const SHOTS = process.env.SHOTS_DIR ?? '../../docs/testing/results/screens-2026-10-02-variants';
const DIR = process.env.CHECK_STATE_DIR ?? './.variants-check';
mkdirSync(DIR, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

if (/:4000\b/.test(KEYLESS)) {
  console.error('Refusing: the keyless api-server must not be :4000.');
  process.exit(2);
}

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const phase = process.argv[2];
const tag = arg('tag') ?? 'A';
const statePath = path.join(DIR, 'storage.json');
const metaPath = path.join(DIR, `site-${tag}.json`);
type Meta = { email: string; projectName?: string; projectId?: string; projectSlug?: string; websiteSlug?: string; sourceId?: string; timings: Record<string, number> };
const session = (): { email: string } => JSON.parse(readFileSync(path.join(DIR, 'session.json'), 'utf8'));
const meta = (): Meta => (existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : { email: session().email, timings: {} });
const saveMeta = (m: Meta) => writeFileSync(metaPath, JSON.stringify(m, null, 2));

const t0 = Date.now();
const lap = (m: Meta, name: string, since: number) => {
  m.timings[name] = Date.now() - since;
  console.log(`[time] ${name}: ${(m.timings[name]! / 1000).toFixed(1)} s`);
};

async function trpc(base: string, cookie: string, proc: string, input: unknown, mutation = false) {
  const body = JSON.stringify({ json: input });
  const res = mutation
    ? await fetch(`${base}/trpc/${proc}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body })
    : await fetch(`${base}/trpc/${proc}?input=${encodeURIComponent(body)}`, { headers: { cookie } });
  const j = (await res.json()) as { result?: { data?: { json?: unknown } }; error?: { json?: { message?: string } } };
  if (!res.ok || j.error) throw new Error(`${proc} on ${base}: HTTP ${res.status} ${j.error?.json?.message ?? JSON.stringify(j).slice(0, 300)}`);
  return j.result?.data?.json as any;
}

async function hydrate(p: Page, selector: string) {
  await p.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps$'));
  }, selector, { timeout: 30_000 });
}

async function poll<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeout: number, what: string): Promise<T> {
  const end = Date.now() + timeout;
  let last: T | undefined;
  while (Date.now() < end) {
    last = await fn().catch(() => undefined as T);
    if (last !== undefined && ok(last)) return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(last)?.slice(0, 400)}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(existsSync(statePath) && phase !== 'signin' ? { storageState: statePath } : {}) });
const page = await context.newPage();
const problems: string[] = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
const cookie = async () => {
  const c = (await context.cookies(API)).find((x) => x.name === 'robot_session');
  if (!c) throw new Error('no robot_session cookie');
  return `${c.name}=${c.value}`;
};
const shoot = async (name: string) => {
  await page.mouse.move(1435, 895);
  const file = path.join(SHOTS, `${tag}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  console.log(`[shot] ${file}`);
};
const siteUrl = (m: Meta) => `${APP}/projects/${m.projectSlug}/sites/${m.websiteSlug}`;
const openSite = async (m: Meta) => {
  await page.goto(siteUrl(m), { waitUntil: 'networkidle', timeout: 60_000 });
  await hydrate(page, 'input[aria-label="Listing page"]');
};

/** Everything the tab says, compactly: rows, Variants step and row, Verify label, Go to Extract. */
async function report() {
  const rows = await page.getByRole('row').evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll('th,td')].map((c) => {
      const btn = c.querySelector('[aria-label]');
      return ((btn?.getAttribute('aria-label') ?? '') + ' | ' + (c as HTMLElement).innerText).replace(/\s+/g, ' ').trim().slice(0, 140);
    }).join(' ‖ ')),
  );
  console.log('--- table');
  for (const r of rows) console.log('  ' + r);
  const step = page.getByRole('region', { name: 'Variants' });
  if (await step.count()) console.log('--- step:', (await step.innerText()).replace(/\s+/g, ' '));
  const verify = page.getByRole('button', { name: /^Verify/ });
  if (await verify.count()) console.log('--- verify button:', await verify.innerText(), (await verify.isDisabled()) ? '(disabled)' : '(enabled)');
  const link = page.getByRole('link', { name: /Go to Extract/ });
  console.log('--- Go to Extract:', (await link.count()) ? 'UNLOCKED (link)' : 'locked');
  const main = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const unlock = /Unlocks when every field( and the variants)? (is|are) verified/.exec(main);
  if (unlock) console.log('--- ', unlock[0]);
  if (problems.length) console.log('--- page errors:\n  ' + problems.join('\n  '));
}

try {
  if (phase === 'signin') {
    const email = `check-${Date.now()}@example.com`;
    await page.goto(`${APP}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
    await hydrate(page, '#email');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill('check');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(`${APP}/projects`, { timeout: 30_000 });
    await context.storageState({ path: statePath });
    writeFileSync(path.join(DIR, 'session.json'), JSON.stringify({ email }));
    console.log('signed in as', email);
  } else if (phase === 'setup') {
    const m = meta();
    const site = arg('site')!;
    const listing = arg('listing')!;
    const fields = (arg('fields') ?? 'Title Text,Price Money').split(',');
    m.projectName = `Variants check ${tag} ${Date.now()}`;

    let s = Date.now();
    await page.goto(`${APP}/projects`, { waitUntil: 'networkidle', timeout: 30_000 });
    await hydrate(page, 'main');
    await page.getByRole('button', { name: 'New project' }).first().click();
    await page.getByLabel('Name').fill(m.projectName);
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByRole('cell', { name: m.projectName, exact: true }).waitFor({ timeout: 20_000 });
    const rows = await trpc(API, await cookie(), 'projects.list', undefined);
    const row = rows.find((r: any) => r.name === m.projectName);
    m.projectId = row.id; m.projectSlug = row.slug; saveMeta(m);

    // Fields, then variants on (one row per variant).
    await page.goto(`${APP}/projects/${m.projectSlug}/fields`, { waitUntil: 'networkidle', timeout: 30_000 });
    await hydrate(page, 'main');
    for (const chip of fields) {
      await page.getByRole('button', { name: chip, exact: true }).click();
      const name = chip.replace(/ (Text|Money|Number|Link|Image|Yes \/ no)$/, '');
      await page.getByRole('textbox', { name: `Name of ${name}` }).waitFor({ timeout: 20_000 });
    }
    await page.getByRole('region', { name: 'Variants' }).waitFor({ timeout: 20_000 });
    await page.getByRole('radio', { name: 'One row per variant', exact: true }).click();
    await page.getByRole('combobox', { name: /^Variants of / }).first().waitFor({ timeout: 20_000 });
    const levels = await page.getByRole('combobox', { name: /^Variants of / }).evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-label')}: ${(e as HTMLElement).innerText}`));
    console.log('levels:', levels.join('; '));

    // Website.
    await page.goto(`${APP}/projects/${m.projectSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await hydrate(page, 'main');
    await page.getByRole('button', { name: 'Add website' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Address').fill(site);
    await page.waitForTimeout(500);
    await dialog.getByRole('button', { name: 'Add website' }).click();
    await page.waitForURL(new RegExp(`/projects/${m.projectSlug}/sites/[^/?]+$`), { timeout: 20_000 });
    m.websiteSlug = new URL(page.url()).pathname.split('/').pop()!;
    const src = await trpc(API, await cookie(), 'sources.get', { projectSlug: m.projectSlug, sourceSlug: m.websiteSlug });
    m.sourceId = src.id;
    lap(m, 'project, fields, variants on, website', s);
    saveMeta(m);

    // Find products, wait for the three screenshots.
    await openSite(m);
    s = Date.now();
    const products = arg('products')?.split(',');
    if (products) {
      // The listing heuristic picked the wrong links on this shop: paste the product pages instead.
      await page.getByRole('button', { name: 'No listing? Paste product pages instead' }).click();
      for (let i = 0; i < products.length; i++) {
        await page.getByRole('textbox', { name: `Product ${i + 1}`, exact: true }).fill(products[i]!);
        await page.getByRole('button', { name: 'Use this page' }).first().click();
        await page.waitForTimeout(800);
      }
      lap(m, 'paste product pages', s);
    } else {
      await page.getByRole('textbox', { name: 'Listing page' }).fill(listing);
      await page.getByRole('button', { name: 'Find products' }).click();
      await poll(() => page.locator('main').innerText(), (t) => /\d+ products? found|No products|could not/i.test(t), 120_000, 'the listing');
      lap(m, 'find products', s);
      console.log('listing says:', /\d+ products? found[^\n]*/.exec(await page.locator('main').innerText())?.[0]);
    }
    s = Date.now();
    await poll(() => page.getByText('ready', { exact: true }).count(), (n) => n >= 3, 180_000, 'three screenshots');
    lap(m, 'screenshots ready', s);
    saveMeta(m);
    await page.waitForTimeout(3000);
    await report();
    const acceptAll = page.getByRole('button', { name: /^Accept all agreed \(\d+\)$/ });
    if ((await acceptAll.count()) && !(await acceptAll.isDisabled())) {
      console.log('clicking', await acceptAll.innerText());
      await acceptAll.click();
      await page.waitForTimeout(2000);
    }
    await report();
    await shoot('1-after-accept');
  } else if (phase === 'inspect') {
    const m = meta();
    await openSite(m);
    await page.waitForTimeout(Number(arg('wait') ?? 4000));
    if (arg('expand')) {
      const t = page.getByRole('rowheader', { name: /^Variants/ }).getByRole('button');
      if (await t.count()) await t.click();
      await page.waitForTimeout(3000);
    }
    await report();
    await shoot(arg('shot') ?? 'inspect');
  } else if (phase === 'delete-field') {
    // A field this shop's page data names wrongly (Everlane's JSON-LD Title is the brand): drop it from the project.
    const m = meta();
    await page.goto(`${APP}/projects/${m.projectSlug}/fields`, { waitUntil: 'networkidle', timeout: 30_000 });
    await hydrate(page, 'main');
    const field = arg('field')!;
    await page.getByRole('button', { name: `Delete ${field}`, exact: true }).click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    if (await confirm.count()) await confirm.getByRole('button', { name: /^Delete/ }).click();
    await poll(() => page.getByRole('textbox', { name: `Name of ${field}` }).count(), (n) => n === 0, 20_000, `${field} to go`);
    console.log('deleted field', field);
    await openSite(m);
    await page.waitForTimeout(5000);
    const acceptAll = page.getByRole('button', { name: /^Accept all agreed \(\d+\)$/ });
    if ((await acceptAll.count()) && !(await acceptAll.isDisabled())) {
      console.log('clicking', await acceptAll.innerText());
      await acceptAll.click();
      await page.waitForTimeout(2500);
    }
    await report();
  } else if (phase === 'replace') {
    // `--n 1 --url <page>`: drop product n and paste another page in its place (no listing queue to draw from).
    const m = meta();
    await openSite(m);
    await page.waitForTimeout(3000);
    const n = Number(arg('n'));
    await page.getByRole('button', { name: `Drop product ${n}`, exact: true }).first().click();
    await page.waitForTimeout(1000);
    const input = page.getByRole('textbox', { name: /^Product \d+$/ }).or(page.getByRole('textbox', { name: 'New product URL' }));
    if (!(await input.count())) await page.getByRole('button', { name: '+ Add product' }).click();
    await input.first().fill(arg('url')!);
    await page.getByRole('button', { name: 'Use this page' }).first().click();
    const s = Date.now();
    await poll(() => page.getByText('ready', { exact: true }).count(), (c) => c >= 3, 180_000, 'three screenshots');
    lap(m, `replace product ${n}, screenshot ready`, s);
    saveMeta(m);
    await page.waitForTimeout(3000);
    await report();
  } else if (phase === 'accept-cell') {
    // `--cells "Price:1,SKU:2"`: the cell's own ✓ for a suggestion.
    const m = meta();
    await openSite(m);
    await page.waitForTimeout(4000);
    for (const c of (arg('cells') ?? '').split(',').filter(Boolean)) {
      const [f, n] = c.split(':');
      await page.locator(`button[aria-label^="${f} on product ${n}: "]`).hover();
      await page.getByRole('button', { name: `Accept ${f} on product ${n}`, exact: true }).click({ force: true });
      await page.waitForTimeout(800);
    }
    const row = arg('row');
    if (row) await page.getByRole('button', { name: new RegExp(`^Accept ${row}( anyway)?$`) }).click();
    await page.waitForTimeout(2500);
    await report();
  } else if (phase === 'step') {
    const m = meta();
    await openSite(m);
    const step = page.getByRole('region', { name: 'Variants' });
    const s = Date.now();
    await poll(() => step.innerText(), (t) => /Listed in the page data|Linked as separate pages|Only in a picker|No variants found|Nothing/i.test(t) || /Variants:/.test(t), 120_000, 'the Variants step');
    console.log('step reads:', (await step.innerText()).replace(/\s+/g, ' '));
    const method = arg('method') ?? 'list';
    const label = method === 'list' ? 'Listed in the page data' : 'Linked as separate pages';
    await page.getByRole('radio', { name: label, exact: true }).click();
    await page.waitForTimeout(500);
    console.log('after choosing:', (await step.innerText()).replace(/\s+/g, ' '));
    await step.scrollIntoViewIfNeeded();
    await shoot(`2-step-${method}`);
    await step.getByRole('button', { name: 'Confirm', exact: true }).click();
    await poll(() => step.innerText(), (t) => /^Variants\s*Variants:/.test(t.trim()) || t.includes('Variants: '), 20_000, 'the set line');
    lap(m, 'variants step', s);
    saveMeta(m);
    console.log('set:', (await step.innerText()).replace(/\s+/g, ' '));
    const src = await trpc(API, await cookie(), 'sources.get', { projectSlug: m.projectSlug, sourceSlug: m.websiteSlug });
    console.log('variantSetup:', JSON.stringify(src.variantSetup));
  } else if (phase === 'counts') {
    const m = meta();
    await openSite(m);
    const s = Date.now();
    const cell = (n: number) => page.locator(`[aria-label^="Variants on product ${n}: "]`);
    await poll(() => cell(1).getAttribute('aria-label'), (v) => !!v, 60_000, 'the Variants row');
    for (const n of [1, 2, 3]) console.log('before:', await cell(n).getAttribute('aria-label'));
    for (const n of [1, 2, 3]) {
      const confirm = page.getByRole('button', { name: `Confirm the variants of product ${n}`, exact: true });
      const none = page.getByRole('button', { name: `No variants on product ${n}`, exact: true });
      if (await confirm.count()) await confirm.click();
      else if (await none.count()) await none.click();
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(2500);
    for (const n of [1, 2, 3]) console.log('after:', await cell(n).getAttribute('aria-label'), (await cell(n).getAttribute('class'))?.match(/border-(pass|warn|line|fail)/)?.[0]);
    lap(m, 'confirm counts', s);
    saveMeta(m);
  } else if (phase === 'spot') {
    const m = meta();
    await openSite(m);
    await page.waitForTimeout(3000);
    const s = Date.now();
    await page.getByRole('rowheader', { name: /^Variants/ }).getByRole('button').click();
    await page.waitForTimeout(4000);
    await report();
    for (let round = 0; round < 3; round++) {
      const accepts = page.getByRole('button', { name: /^Accept .* of the checked variant on product \d$/ });
      const n = await accepts.count();
      if (!n) break;
      for (const name of await accepts.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!))) {
        console.log('clicking', name);
        await page.getByRole('button', { name, exact: true }).click();
        await page.waitForTimeout(600);
      }
    }
    for (const fp of (arg('from-product') ?? '').split(',').filter(Boolean)) {
      // "In stock:1" -> "In stock of product 1 from the product page"
      const [f, n] = fp.split(':');
      await page.getByRole('button', { name: `${f} of product ${n} from the product page`, exact: true }).click();
      await page.waitForTimeout(600);
    }
    // Links: wait for each checked page's screenshot.
    if (await page.getByText(/^Checking the /).count()) {
      await poll(() => page.getByText('taking screenshot…').count(), (c) => c === 0, 180_000, 'the checked variant pages').catch((e) => console.log(String(e)));
    }
    await page.waitForTimeout(2500);
    lap(m, 'spot-check', s);
    saveMeta(m);
    await report();
    const src = await trpc(API, await cookie(), 'sources.get', { projectSlug: m.projectSlug, sourceSlug: m.websiteSlug });
    console.log('stored variants:', JSON.stringify(src.verificationSet?.variants, null, 1)?.slice(0, 3000));
    await page.getByRole('rowheader', { name: /^Variants/ }).scrollIntoViewIfNeeded();
    await shoot('3-spot');
  } else if (phase === 'verify') {
    const m = meta();
    const c = await cookie();
    const health = await fetch(`${KEYLESS}/healthz`).catch(() => null);
    if (!health?.ok) throw new Error(`the keyless api-server is not up at ${KEYLESS}`);
    // The app's first-run rule: no onlyKeys on a first Verify (every field).
    const onlyKeys = arg('only-keys') === undefined ? undefined : arg('only-keys') === '' ? [] : arg('only-keys')!.split(',');
    const estimate = await trpc(KEYLESS, c, 'sources.verifyEstimate', { sourceId: m.sourceId, ...(onlyKeys ? { onlyKeys } : {}) });
    console.log('verifyEstimate on :4100:', JSON.stringify(estimate));
    if (estimate.aiAvailable !== false || estimate.upperBoundUsd !== 0) {
      console.error('STOP: the keyless api-server says AI is available. Nothing was verified.');
      process.exit(3);
    }
    const s = Date.now();
    const started = await trpc(KEYLESS, c, 'sources.verify', { sourceId: m.sourceId, ...(onlyKeys ? { onlyKeys } : {}) }, true);
    console.log('verify:', JSON.stringify(started));
    const status = await poll(
      () => trpc(KEYLESS, c, 'sources.verificationStatus', { sourceId: m.sourceId }),
      (st: any) => st?.id === started.verificationId && !!st.completedAt,
      600_000,
      'the verification to complete',
    );
    lap(m, 'verify (keyless :4100)', s);
    saveMeta(m);
    console.log('allPassed:', status.allPassed, 'error:', status.errorMessage, 'aiCalls:', status.aiCalls, 'costUsd:', status.costUsd, 'current:', status.current);
    for (const [k, r] of Object.entries(status.results ?? {}) as Array<[string, any]>) {
      console.log(`  field ${k}: passed=${r.passed ?? r.status} certified=${(r.certified ?? []).length}`, JSON.stringify(r).slice(0, 400));
    }
    console.log('variants:', JSON.stringify(status.variants, null, 1).slice(0, 4000));
    writeFileSync(path.join(DIR, `verify-${tag}.json`), JSON.stringify(status, null, 2));
  } else if (phase === 'after') {
    const m = meta();
    await openSite(m);
    await page.waitForTimeout(5000);
    const t = page.getByRole('rowheader', { name: /^Variants/ }).getByRole('button');
    if (await t.count()) await t.click();
    await page.waitForTimeout(2500);
    await report();
    await shoot('4-after-verify');
  } else if (phase === 'cleanup') {
    const m = meta();
    await trpc(API, await cookie(), 'projects.delete', { projectId: m.projectId }, true);
    console.log('deleted project', m.projectName);
  } else {
    console.error(`unknown phase ${phase}`);
    process.exit(2);
  }
} catch (err) {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  await page.screenshot({ path: path.join(SHOTS, `${tag}-error-${phase}.png`), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  console.log(`[phase ${phase}] ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await browser.close();
}
