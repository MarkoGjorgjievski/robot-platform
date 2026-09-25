// A free live run of the Verification tab (`@robot/app`, plan 5) on a real
// shop: Ikea, end to end, as a throwaway identity — find products from a
// listing, let every screenshot land, confirm every suggestion, mark what is
// left by clicking, and press Verify — against an api-server with NO Anthropic
// key, so Verify is mechanical only and costs nothing.
//
// **It spends nothing by construction.** Captures, suggestions and transfers
// never use a model. Verify is the one control that can, and this check
// (1) refuses to run against an api-server whose `verifyEstimate` says AI is
// available, and (2) reads the Verify button before clicking it and aborts
// unless it reads "free" / "mechanical only" with no dollar amount in it.
//
// It never signs in as a real person and never reads a real project: it signs
// up `check-<timestamp>@example.com`, builds its own project, and deletes that
// project at the end (the user row and its personal organisation stay behind,
// as the smoke's do).
//
// Needs a SECOND, keyless stack beside the everyday one — never the :4000
// api-server, which has the key:
//
//   cd packages/api-server && ANTHROPIC_API_KEY= PORT=4100 pnpm exec tsx src/index.ts
//   cd packages/app && VITE_API_URL=http://localhost:4100 pnpm exec vite dev --port 3100 --strictPort
//
// The api-server's CORS list names :3000 and :3456 only, so the browser here
// is launched with `--disable-web-security`: that is what lets the :3100 app
// call :4100. It is this check's browser only, and it only ever visits the app.
//
// Run from packages/browser so `playwright` resolves:
//   cp docs/testing/ui-check-app-verification.mts packages/browser/src/__ui-check.mts \
//     && cd packages/browser && pnpm exec tsx src/__ui-check.mts ; rm src/__ui-check.mts
//
// Options: `--listing <url>` (default Ikea Malaysia's Cabinets category),
// `--site <url>` (the website's address, default `https://www.ikea.com/my/en/`).
// Screenshots go to `docs/testing/screens/app-site-verification-ikea-{marking,verified}-{dark,light}.png`
// (resolved from packages/browser; `SCREENS_DIR` overrides). The numbers it
// prints are what `docs/testing/2026-09-25-verification-live.md` records.
import { chromium, type Page } from 'playwright';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const APP = process.env.APP_URL ?? 'http://localhost:3100';
const API = process.env.API_URL ?? 'http://localhost:4100';
const SCREENS = process.env.SCREENS_DIR ?? '../../docs/testing/screens';
const LISTING = arg('listing') ?? 'https://www.ikea.com/my/en/cat/cabinets-10409/';
const SITE_URL = arg('site') ?? 'https://www.ikea.com/my/en/';
const STAMP = Date.now();
const EMAIL = `check-${STAMP}@example.com`;
const PROJECT_NAME = `Ikea check ${STAMP}`;

/**
 * The catalogue chips this check adds, as each chip's accessible name (name +
 * the type shown beside it). The first six are what the existing Ikea website
 * verifies; SKU and Brand are here because Ikea keeps them in its JSON-LD —
 * the path where page data holds a value that may have no element of its own
 * on the screenshot, offered on the field's row instead.
 */
const FIELDS = [
  { key: 'title', name: 'Title', chip: 'Title Text' },
  { key: 'product_url', name: 'Product URL', chip: 'Product URL Link' },
  { key: 'price', name: 'Price', chip: 'Price Money' },
  { key: 'in_stock', name: 'In stock', chip: 'In stock Yes / no' },
  { key: 'description', name: 'Description', chip: 'Description Text' },
  { key: 'main_image', name: 'Main image', chip: 'Main image Image' },
  { key: 'sku', name: 'SKU', chip: 'SKU Text' },
  { key: 'brand', name: 'Brand', chip: 'Brand Text' },
] as const;

if (/:4000\b/.test(API)) {
  console.error('Refusing to run against :4000 — that api-server has the Anthropic key. Start the keyless one on :4100.');
  process.exit(2);
}

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};
const measure = (name: string, value: string | number) => console.log(`      ${name}: ${value}`);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const b = await chromium.launch({ headless: true, args: ['--disable-web-security'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();

let errors: string[] = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon|Download the React DevTools/i.test(t)) return;
  errors.push('console: ' + t.slice(0, 200));
});

/**
 * What each `transferMarks` answered: per target product, the fields it
 * carried an answer to. A product that already had a page-data suggestion for
 * a field shows no change on screen, so the response is the honest count.
 */
const transfers: Array<{ field: string; to: Record<string, number> }> = [];
p.on('response', async (r) => {
  if (!r.url().includes('sources.transferMarks') || r.request().method() !== 'POST') return;
  try {
    const input = JSON.parse(r.request().postData() ?? '{}') as Record<string, { json?: { fieldKeys?: string[] } }> & { json?: { fieldKeys?: string[] } };
    const sent = input.json ?? input['0']?.json;
    const body = (await r.json()) as unknown;
    const out = (Array.isArray(body) ? (body[0] as { result?: { data?: { json?: unknown } } }) : (body as { result?: { data?: { json?: unknown } } })).result?.data?.json as
      | Record<string, { fields: Record<string, { boxes: number[] } | null> } | null>
      | undefined;
    const field = sent?.fieldKeys?.[0] ?? '?';
    const to: Record<string, number> = {};
    for (const [url, res] of Object.entries(out ?? {})) to[url] = res?.fields[field] ? (res.fields[field]!.boxes.length) : -1;
    transfers.push({ field, to });
  } catch {
    /* a response this check cannot read is not a failure of the tab */
  }
});

/** Every tRPC procedure the page asked for, in the order first seen. */
const called: string[] = [];
p.on('request', (r) => {
  const m = /\/trpc\/([^?]+)/.exec(r.url());
  if (!m) return;
  for (const name of decodeURIComponent(m[1]!).split(',')) if (name && !called.includes(name)) called.push(name);
});

async function cookieHeader(): Promise<string> {
  const cookies = await ctx.cookies(API);
  return cookies.filter((c) => c.name === 'robot_session').map((c) => `${c.name}=${c.value}`).join('; ');
}

async function query<T>(path: string, input: unknown): Promise<T> {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const res = await fetch(`${API}/trpc/${path}?input=${encoded}`, { headers: { cookie: await cookieHeader() } });
  const body = (await res.json()) as { result?: { data?: { json?: T } } };
  const data = body.result?.data?.json;
  if (data === undefined) throw new Error(`${path} did not answer: ${JSON.stringify(body).slice(0, 200)}`);
  return data;
}

async function mutate<T>(path: string, input: unknown): Promise<T> {
  const res = await fetch(`${API}/trpc/${path}`, {
    method: 'POST',
    headers: { cookie: await cookieHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const body = (await res.json()) as { result?: { data?: { json?: T } } };
  return body.result?.data?.json as T;
}

async function hydrated(selector: string) {
  await p.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps$'));
    },
    selector,
    { timeout: 30_000 },
  );
}

async function until(what: string, fn: () => Promise<boolean>, timeoutMs: number, everyMs = 1000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await p.waitForTimeout(everyMs);
  }
  console.log(`      (gave up waiting for ${what} after ${seconds(timeoutMs)})`);
  return false;
}

const shoot = async (file: string) => {
  await p.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    for (const el of document.querySelectorAll<HTMLElement>('*')) if (el.scrollTop > 0) el.scrollTo({ top: 0, behavior: 'instant' });
  });
  await p.mouse.move(1435, 895);
  await p.screenshot({ path: `${SCREENS}/${file}`, fullPage: true, animations: 'disabled' });
};

/** Theme through the user menu, without a reload: what is on the screen stays on it. */
async function flipTheme(theme: 'dark' | 'light') {
  await p.locator('aside button').filter({ hasText: EMAIL }).first().click();
  await p.getByRole('menuitem', { name: 'Theme' }).click();
  const saved = p.waitForResponse((r) => r.url().includes('auth.setTheme'), { timeout: 15_000 }).catch(() => null);
  await p.getByRole('menuitemradio', { name: theme === 'dark' ? 'Dark' : 'Light' }).click();
  await saved;
  await p.keyboard.press('Escape');
  await until('the theme', async () => (await p.evaluate(() => document.documentElement.dataset.theme)) === theme, 10_000, 200);
}

async function shootBoth(name: string) {
  const current = ((await p.evaluate(() => document.documentElement.dataset.theme)) ?? 'dark') as 'dark' | 'light';
  const other = current === 'dark' ? 'light' : 'dark';
  await shoot(`app-site-verification-ikea-${name}-${current}.png`);
  await flipTheme(other);
  await shoot(`app-site-verification-ikea-${name}-${other}.png`);
  await flipTheme(current);
}

const battery = (name: string) => p.locator(`[role="img"][aria-label^="${name}: "]`).getAttribute('aria-label');
const segmentWord = async (name: string, product: number) => {
  for (const w of ['confirmed', 'suggested', 'empty', 'failed']) {
    if ((await p.getByRole('button', { name: `${name} on product ${product}: ${w}`, exact: true }).count()) > 0) return w;
  }
  return '?';
};
const card = (i: number) => p.locator('button[aria-pressed]').nth(i);
const selectedProduct = async () => {
  const n = await p.locator('button[aria-pressed]').count();
  for (let i = 0; i < n; i++) if ((await card(i).getAttribute('aria-pressed')) === 'true') return i;
  return -1;
};

/** The field rows' hint lines for the product on screen: "page data: …", "found in n places — …", "from another product: …". */
async function rowHints(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of FIELDS) {
    const row = p.locator('li').filter({ has: p.locator(`[role="img"][aria-label^="${f.name}: "]`) });
    const hint = row.locator('span.text-warn');
    if ((await hint.count()) > 0) out[f.name] = norm(await hint.first().innerText());
  }
  return out;
}

/** Each field's state on product `i` (0-based), from the battery segment. */
async function statesOn(i: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of FIELDS) out[f.name] = await segmentWord(f.name, i + 1);
  return out;
}

let clicks = 0;
const click = async (what: () => Promise<void>) => {
  await what();
  clicks++;
};

/** Tick every suggestion on the product on screen: rectangles by their label, row lines by their ✓. */
async function confirmAllSuggestions(i: number): Promise<{ onScreen: string[]; chosen: string[]; onRow: string[]; skipped: string[] }> {
  const onScreen: string[] = [];
  const chosen: string[] = [];
  const onRow: string[] = [];
  const skipped: string[] = [];
  for (const f of FIELDS) {
    if ((await segmentWord(f.name, i + 1)) !== 'suggested') continue;
    const label = p.locator('span', { hasText: new RegExp(`^${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?$`) });
    const row = p.getByRole('button', { name: `Confirm ${f.name} from the page data` });
    const places = await label.count();
    if (places >= 1) {
      // One rectangle: tick it. Several ("found in n places — click the right
      // one"): a person would look and pick; this check takes the first the
      // page data names, and says so in the numbers. The rectangle itself is
      // scrolled into view, not its label, which sits above it.
      const target = label.nth(0);
      await target.locator('..').scrollIntoViewIfNeeded().catch(() => {});
      const box = await target.locator('..').boundingBox();
      if (!box) {
        skipped.push(`${f.name} (rectangle off screen)`);
        continue;
      }
      await click(() => p.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 10)));
      const confirm = p.getByRole('button', { name: `Confirm ${f.name}`, exact: true });
      if (!(await until(`the ${f.name} popover`, async () => (await confirm.count()) > 0, 5_000, 200))) {
        const pop = p.locator('[data-slot="popover-content"]');
        const opened = (await pop.count()) > 0 ? norm(await pop.innerText()).slice(0, 80) : 'nothing opened';
        const around = await p.evaluate(([x, y]) => document.elementsFromPoint(x, y).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}${e.textContent && e.children.length === 0 ? `"${e.textContent.slice(0, 20)}"` : ''}`).join(' > '), [box.x + box.width / 2, box.y + Math.min(box.height / 2, 10)] as const);
        await p.screenshot({ path: `${SCREENS}/../ui-check-verification-${f.key}-p${i + 1}.png` }).catch(() => {});
        skipped.push(`${f.name} (the click on its rectangle opened: ${opened}; under the pointer: ${around}; rect ${Math.round(box.width)}×${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)})`);
        await p.keyboard.press('Escape');
        continue;
      }
      await click(() => confirm.click());
      (places > 1 ? chosen : onScreen).push(places > 1 ? `${f.name} (1 of ${places})` : f.name);
    } else if ((await row.count()) > 0) {
      await click(() => row.click());
      onRow.push(f.name);
    } else {
      skipped.push(`${f.name} (${(await rowHints())[f.name] ?? 'no rectangle and no row line'})`);
    }
    await until(`${f.name} to turn green`, async () => (await segmentWord(f.name, i + 1)) === 'confirmed', 10_000, 200);
  }
  return { onScreen, chosen, onRow, skipped };
}

let projectId: string | null = null;

try {
  // ── The stack is the keyless one ─────────────────────────────────────────
  const health = await fetch(`${API}/healthz`).then((r) => r.ok).catch(() => false);
  check(`the api-server answers at ${API}`, health);
  if (!health) throw new Error('no api-server');

  // ── Sign up a throwaway, build a project with Ikea's fields ───────────────
  await p.goto(`${APP}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
  await hydrated('#email');
  await p.locator('#email').fill(EMAIL);
  await p.locator('#password').fill('check');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL(`${APP}/projects`, { timeout: 60_000 });
  console.log(`signed in as ${EMAIL}`);

  await hydrated('main');
  await p.getByRole('button', { name: 'New project' }).first().click();
  await p.getByLabel('Name').fill(PROJECT_NAME);
  await p.getByRole('button', { name: 'Create project' }).click();
  await p.getByRole('cell', { name: PROJECT_NAME, exact: true }).waitFor({ timeout: 30_000 });
  const projects = await query<Array<{ id: string; name: string; slug: string }>>('projects.list', {});
  const project = projects.find((x) => x.name === PROJECT_NAME)!;
  projectId = project.id;

  await p.goto(`${APP}/projects/${project.slug}/fields`, { waitUntil: 'networkidle' });
  await hydrated('main');
  for (const f of FIELDS) {
    await p.getByRole('button', { name: f.chip, exact: true }).click();
    await p.getByRole('textbox', { name: `Name of ${f.name}` }).waitFor({ timeout: 20_000 });
  }
  check(`the project has Ikea's ${FIELDS.length} fields`, true, FIELDS.map((f) => f.name).join(', '));

  await p.goto(`${APP}/projects/${project.slug}`, { waitUntil: 'networkidle' });
  await hydrated('main');
  await p.getByRole('button', { name: 'Add website' }).first().click();
  const dialog = p.getByRole('dialog');
  await dialog.getByLabel('Address').fill(SITE_URL);
  await until('the name prefill', async () => (await dialog.getByLabel('Name').inputValue()) !== '', 10_000, 200);
  await dialog.getByRole('button', { name: 'Add website' }).click();
  await p.waitForURL(new RegExp(`/projects/${project.slug}/sites/[^/?]+$`), { timeout: 30_000 });
  const siteSlug = new URL(p.url()).pathname.split('/').pop()!;
  check('Add website lands on the Verification tab', /\/sites\/[^/]+$/.test(new URL(p.url()).pathname), p.url());
  const site = await query<{ id: string }>('sources.get', { projectSlug: project.slug, sourceSlug: siteSlug });
  const estimate = await query<{ aiAvailable: boolean }>('sources.verifyEstimate', { sourceId: site.id });
  check('verifyEstimate says no model is available on this api-server', estimate.aiAvailable === false, JSON.stringify(estimate).slice(0, 120));
  if (estimate.aiAvailable) throw new Error('this api-server has a key; refusing to go on');

  // ── The listing ───────────────────────────────────────────────────────────
  await hydrated('input[aria-label="Listing page"]');
  await p.getByRole('textbox', { name: 'Listing page' }).fill(LISTING);
  const listingStart = Date.now();
  await click(() => p.getByRole('button', { name: 'Find products' }).click());
  const found = await until('the listing', async () => /products found|No product links found/.test(await p.locator('main').innerText()), 120_000);
  const listingMs = Date.now() - listingStart;
  const foundLine = norm((await p.locator('main p').filter({ hasText: /products found|No product links/ }).first().innerText().catch(() => '')) || '');
  check('Find products answers', found, foundLine);
  measure('listing time', seconds(listingMs));
  const cardCount = await p.locator('button[aria-pressed]').count();
  const titles = await p.locator('button[aria-pressed] p.line-clamp-2').allInnerTexts();
  check('three product cards', cardCount === 3, titles.map(norm).join(' | '));
  const withImage = await p.locator('button[aria-pressed] img').count();
  measure('cards with a photo', `${withImage} of ${cardCount}`);

  // ── The screenshots, per product ──────────────────────────────────────────
  const readyAt: number[] = [];
  await until(
    'three screenshots',
    async () => {
      const lines = await p.locator('button[aria-pressed]').locator('xpath=..').locator('div.mt-auto span').allInnerTexts();
      lines.forEach((l, i) => {
        if (readyAt[i] === undefined && norm(l) === 'ready') readyAt[i] = Date.now() - listingStart - listingMs;
      });
      return lines.length === 3 && lines.every((l) => norm(l) !== 'taking screenshot…');
    },
    240_000,
    500,
  );
  const stateLines = (await p.locator('button[aria-pressed]').locator('xpath=..').locator('div.mt-auto span').allInnerTexts()).map(norm);
  check('every product has its screenshot', stateLines.every((l) => l === 'ready'), stateLines.join(' | '));
  measure('capture time per product (from the listing answering)', readyAt.map((ms, i) => `product ${i + 1}: ${ms === undefined ? '—' : seconds(ms)}`).join(', '));

  // Page data lands per product; give the last one a moment.
  await p.waitForTimeout(3000);

  // What page data suggested, product by product — before anything is ticked,
  // so nothing here is a transfer. Each product is opened in turn.
  const pageData: Record<number, { states: Record<string, string>; hints: Record<string, string> }> = {};
  for (let i = 0; i < 3; i++) {
    await click(() => card(i).click());
    await until(`product ${i + 1} to open`, async () => (await selectedProduct()) === i, 10_000, 200);
    await p.waitForTimeout(1500);
    pageData[i] = { states: await statesOn(i), hints: await rowHints() };
    const suggested = Object.entries(pageData[i]!.states).filter(([, s]) => s === 'suggested').map(([n]) => n);
    measure(`product ${i + 1}, suggested from page data`, `${suggested.length} of ${FIELDS.length}: ${suggested.join(', ') || '—'}`);
    for (const [n, h] of Object.entries(pageData[i]!.hints)) measure(`product ${i + 1}, ${n}'s row says`, h);
  }

  // ── Confirm product 1's suggestions; what carries to 2 and 3 ──────────────
  await click(() => card(0).click());
  await until('product 1 to open', async () => (await selectedProduct()) === 0, 10_000, 200);
  await p.waitForTimeout(1000);
  const first = await confirmAllSuggestions(0);
  measure('product 1: ticked on the screenshot', first.onScreen.join(', ') || '—');
  measure('product 1: picked from several rectangles', first.chosen.join(', ') || '—');
  measure('product 1: ticked on the row (page data, no element)', first.onRow.join(', ') || '—');
  if (first.skipped.length) measure('product 1: left for a person', first.skipped.join('; '));
  await p.waitForTimeout(4000); // transfers are one browser call per tick

  // Carried by transfer = empty on product n from page data, suggested now.
  const carried: Record<number, string[]> = {};
  for (const i of [1, 2]) {
    const now = await statesOn(i);
    carried[i] = FIELDS.map((f) => f.name).filter((n) => pageData[i]!.states[n] === 'empty' && now[n] === 'suggested');
    measure(`product ${i + 1}, carried from product 1`, carried[i]!.join(', ') || '—');
  }
  const carriedBy = transfers.map((x) => `${x.field} → ${Object.values(x.to).map((n) => (n < 0 ? 'nothing' : n === 0 ? 'a value, no element' : `${n} element(s)`)).join(' / ')}`);
  measure('transferMarks answers (per tick, per other product)', carriedBy.join('; ') || 'none');
  await shootBoth('marking');

  for (const i of [1, 2]) {
    await click(() => card(i).click());
    await until(`product ${i + 1} to open`, async () => (await selectedProduct()) === i, 10_000, 200);
    await p.waitForTimeout(1500);
    const r = await confirmAllSuggestions(i);
    measure(`product ${i + 1}: ticked on the screenshot`, r.onScreen.join(', ') || '—');
    measure(`product ${i + 1}: picked from several rectangles`, r.chosen.join(', ') || '—');
    measure(`product ${i + 1}: ticked on the row`, r.onRow.join(', ') || '—');
    if (r.skipped.length) measure(`product ${i + 1}: left for a person`, r.skipped.join('; '));
  }

  // What is left: fields still grey on any of products 1–3. This check does
  // not guess where a value is — that is the customer's judgement — so a
  // grey cell is reported, and Verify stays off, saying which.
  const left: string[] = [];
  for (let i = 0; i < 3; i++) {
    const s = await statesOn(i);
    for (const [n, w] of Object.entries(s)) if (w !== 'confirmed') left.push(`${n} on product ${i + 1} (${w})`);
  }
  measure('transferMarks calls in all', `${transfers.length}, carrying ${transfers.reduce((n, x) => n + Object.values(x.to).filter((v) => v >= 0).length, 0)} field-product suggestions`);
  measure('still to mark by hand after every suggestion is ticked', left.join(', ') || 'nothing');
  measure('batteries', (await Promise.all(FIELDS.map((f) => battery(f.name)))).join(' | '));
  measure('clicks so far (find, card switches, rectangles, ticks)', clicks);

  // ── Verify, only if it is free ────────────────────────────────────────────
  const verify = p.getByRole('button', { name: /^Verify/ });
  const label = norm(await verify.innerText());
  // The disabled button's reason is the span beside it (spec: within one line).
  const reasonOf = async () => norm((await verify.locator('xpath=following-sibling::span[1]').innerText({ timeout: 1000 }).catch(() => '')) || '');
  await until('the last save', async () => (await p.getByText('saved', { exact: true }).count()) === 1, 15_000, 300);
  const reason = await reasonOf();
  measure('Verify reads', `${label}${reason ? ` — ${reason}` : ''}`);
  const free = /free|mechanical only/.test(label) && !label.includes('$');
  check('the Verify button says it is free', free, label);
  if (!free) throw new Error(`Verify does not read free ("${label}"); not clicking it`);

  if (await until('Verify to be enabled', () => verify.isEnabled(), 10_000, 500)) {
    // Unmarked fields can still be typed; this check only presses Verify when
    // the tab itself says every field is answered on products 1–3.
    const started = Date.now();
    await verify.click();
    const settled = await until(
      'the verification',
      async () => {
        const rows = await Promise.all(FIELDS.map((f) => p.locator('li').filter({ has: p.locator(`[role="img"][aria-label^="${f.name}: "]`) }).innerText()));
        return rows.every((r) => !r.includes('checking…')) && rows.some((r) => /verified|fails on product|changed since verified/.test(r));
      },
      600_000,
      3000,
    );
    measure('verification took', seconds(Date.now() - started));
    check('the verification settles', settled);
    const badges: Record<string, string> = {};
    for (const f of FIELDS) {
      const r = norm(await p.locator('li').filter({ has: p.locator(`[role="img"][aria-label^="${f.name}: "]`) }).first().innerText());
      // "changed since verified" contains "verified", so it is asked first.
      badges[f.name] = /changed since verified/.test(r)
        ? 'changed since verified'
        : (/fails on product \d/.exec(r)?.[0] ?? (/\bverified\b/.test(r) ? 'verified' : 'no badge'));
    }
    const verified = Object.values(badges).filter((x) => x === 'verified').length;
    measure('badges', Object.entries(badges).map(([n, x]) => `${n}: ${x}`).join(', '));
    check(`verified count`, true, `${verified} of ${FIELDS.length}`);
    const red = [];
    for (const f of FIELDS) for (let i = 1; i <= 3; i++) if ((await segmentWord(f.name, i)) === 'failed') red.push(`${f.name} on product ${i}`);
    measure('red segments', red.join(', ') || 'none');
    measure('Go to Extract', (await p.getByRole('link', { name: 'Go to Extract' }).count()) > 0 ? 'live' : 'locked');
    await shootBoth('verified');
  } else {
    check('Verify is enabled after every suggestion is confirmed', false, (await reasonOf()) || 'no reason shown');
    await shootBoth('verified');
  }

  check('the page logged no errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  measure('procedures called', [...called].sort().join(', '));
} catch (err) {
  failed++;
  console.error('ABORTED:', err instanceof Error ? err.message : err);
  await p.screenshot({ path: `${SCREENS}/../ui-check-verification-abort.png`, fullPage: true }).catch(() => {});
} finally {
  if (projectId) {
    const res = await mutate('projects.delete', { projectId }).then(() => 'deleted', (e) => `NOT deleted: ${e}`);
    console.log(`throwaway project ${projectId}: ${res}`);
  }
  await b.close();
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
