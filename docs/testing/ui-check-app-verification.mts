// A free live run of the Verification tab (`@robot/app`; plan 5, table-first
// since 2026-09-28) on a real shop: Ikea, end to end, as a throwaway identity
// — find products from a listing, let every screenshot land, read what each
// row of the table needs, Accept all agreed, open a cell's screenshot for
// each row that needs you and tick what is there, and press Verify — against
// an api-server with NO Anthropic key, so Verify reads "free" and costs
// nothing. It counts every click from Find products to an enabled Verify.
//
// **It spends nothing by construction.** Captures, suggestions and transfers
// never use a model. Verify is the one control that can, and this check
// (1) refuses to run against an api-server whose `verifyEstimate` says AI is
// available, and (2) reads the Verify button before clicking it and aborts
// unless it reads "free" with no dollar amount in it.
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
// Screenshots go to `docs/testing/screens/app-site-verification-ikea-{agreed,verified}-{dark,light}.png`
// (resolved from packages/browser; `SCREENS_DIR` overrides). The numbers it
// prints are what `docs/testing/2026-09-28-table-first-live.md` records (plan 5's
// run, before the table: `docs/testing/2026-09-25-verification-live.md`).
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

/**
 * Where page data found each field, per capture, in the order answered:
 * `{ captureId, fields: { key: "json-ld offers.price = 399 (1 element)" } }`.
 * A row reads "comes from different places" when these paths differ between
 * products, so they are what explains it.
 */
const suggested: Array<{ captureId: string; fields: Record<string, string> }> = [];
p.on('response', async (r) => {
  if (!r.url().includes('sources.suggestMarks')) return;
  try {
    const body = (await r.json()) as unknown;
    const list = (Array.isArray(body) ? body : [body]) as Array<{ result?: { data?: { json?: unknown } } }>;
    for (const item of list) {
      const out = item.result?.data?.json as
        | { captureId: string; fields: Record<string, { value: string; via: { source: string; path: string }; boxes: number[] } | null> }
        | undefined;
      if (!out?.fields) continue;
      const fields: Record<string, string> = {};
      for (const [k, s] of Object.entries(out.fields)) fields[k] = s ? `${s.via.source} ${s.via.path} = ${s.value.slice(0, 40)} (${s.boxes.length} element(s))` : '—';
      suggested.push({ captureId: out.captureId, fields });
    }
  } catch {
    /* a response this check cannot read is not a failure of the tab */
  }
});
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

/** A cell of the table, by the state word its label ends in: empty, suggested, accepted or failed. */
const cellButton = (name: string, product: number) => p.locator(`button[aria-label^="${name} on product ${product}: "]`);
async function cellState(name: string, product: number): Promise<string> {
  const cell = cellButton(name, product);
  if ((await cell.count()) !== 1) return '?';
  return ((await cell.getAttribute('aria-label')) ?? '').slice(`${name} on product ${product}: `.length);
}
async function statesOn(i: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of FIELDS) out[f.name] = await cellState(f.name, i + 1);
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rowOf = (name: string) => p.getByRole('row').filter({ has: p.getByRole('rowheader', { name: new RegExp(`^${escape(name)}\\b`) }) });

/** What a row's last column reads, whitespace folded: "agreed Accept", "missing on product 2", "verified", "". */
async function statusText(name: string): Promise<string> {
  return norm(await rowOf(name).locator('td').last().innerText());
}
type Kind = 'agreed' | 'same-everywhere' | 'needs-you' | 'accepted';
const kindOf = (text: string): Kind =>
  text === 'agreed Accept'
    ? 'agreed'
    : text.startsWith('same on every product')
      ? 'same-everywhere'
      : text === '' || /^(verified|fails on product \d+|changed since verified|checking…)$/.test(text)
        ? 'accepted'
        : 'needs-you';
async function statuses(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of FIELDS) out[f.name] = await statusText(f.name);
  return out;
}

const card = (i: number) => p.locator('button[aria-pressed]').nth(i);
const panel = () => p.getByRole('region', { name: 'Screenshot' });

let clicks = 0;
const click = async (what: () => Promise<void>) => {
  await what();
  clicks++;
};

/**
 * Accept one suggested cell the way a person does: click the cell (the
 * product's screenshot opens with the field outlined), then tick the orange
 * rectangle — or, when no element shows the value, the expanded row's
 * "page data" line. Several rectangles ("found in n places"): a person would
 * look and pick; this check takes the first, and says so in the numbers.
 */
async function tickCell(name: string, product: number): Promise<string> {
  await click(() => cellButton(name, product).click());
  await until(`product ${product} in the address`, async () => new URL(p.url()).searchParams.get('product') === String(product), 5_000, 100);
  await until(`product ${product}'s screenshot`, async () => (await panel().locator('img[alt="Screenshot of this product"]').count()) > 0, 20_000, 200);
  const label = panel().locator('span', { hasText: new RegExp(`^${escape(name)}\\?$`) });
  await until(`the ${name} rectangle`, async () => (await label.count()) > 0, 3_000, 200);
  const places = await label.count();
  if (places > 0) {
    const target = label.nth(0).locator('..');
    // A product switch swaps the tiles (the rectangles are hidden until the new
    // screenshot has a scale) and the tab then scrolls the element into view:
    // read the rectangle's place only once it has stopped moving.
    let box = await target.boundingBox();
    await until(
      `the ${name} rectangle to stop moving`,
      async () => {
        await p.waitForTimeout(300);
        const next = await target.boundingBox();
        const still = !!box && !!next && box.x === next.x && box.y === next.y;
        box = next;
        return still;
      },
      5_000,
      0,
    );
    const vh = p.viewportSize()?.height ?? 900;
    if (box && (box.y < 0 || box.y + box.height > vh)) {
      measure(`${name} on product ${product}`, `the tab left its rectangle off screen (y ${Math.round(box.y)}); scrolled to it`);
      await target.scrollIntoViewIfNeeded().catch(() => {});
      box = await target.boundingBox();
    }
    if (box) {
      await click(() => p.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 10)));
      const confirm = p.getByRole('button', { name: `Confirm ${name}`, exact: true });
      if (await until(`the ${name} popover`, async () => (await confirm.count()) > 0, 5_000, 200)) {
        await click(() => confirm.click());
        await until(`${name} on product ${product} to be accepted`, async () => (await cellState(name, product)) === 'accepted', 10_000, 200);
        return places > 1 ? `on the screenshot, 1 of ${places} places` : 'on the screenshot';
      }
      // Say what the click did open, and what was under the pointer.
      const pop = p.locator('[data-slot="popover-content"]');
      const opened = (await pop.count()) > 0 ? norm(await pop.innerText()).slice(0, 120) : 'nothing opened';
      const at = [box.x + box.width / 2, box.y + Math.min(box.height / 2, 10)] as const;
      const under = await p.evaluate(
        ([x, y]) => document.elementsFromPoint(x, y).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}${e.textContent && e.children.length === 0 ? `"${e.textContent.slice(0, 20)}"` : ''}`).join(' > '),
        at,
      );
      measure(`${name} on product ${product}: the rectangle click opened`, `${opened}; under the pointer: ${under}; rect ${Math.round(box.width)}×${Math.round(box.height)}`);
      await p.screenshot({ path: `${SCREENS}/../ui-check-verification-${name.replace(/\W+/g, '-').toLowerCase()}-p${product}.png` }).catch(() => {});
      await p.keyboard.press('Escape');
    }
  }
  // No rectangle to tick: the expanded row's page-data line.
  const fromRow = p.getByRole('button', { name: `Confirm ${name} from the page data` });
  if ((await fromRow.count()) === 0) {
    const toggle = rowOf(name).getByRole('button', { name: new RegExp(`^${escape(name)}$`) });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await click(() => toggle.click());
  }
  if (await until(`${name}'s page-data line`, async () => (await fromRow.count()) > 0, 3_000, 200)) {
    await click(() => fromRow.click());
    await until(`${name} on product ${product} to be accepted`, async () => (await cellState(name, product)) === 'accepted', 10_000, 200);
    return 'on the row (page data)';
  }
  return 'nothing to tick';
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
  const titles = await p.locator('button[aria-pressed] p.line-clamp-1').allInnerTexts();
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

  // ── What each row needs, before any click ─────────────────────────────────
  // Page data lands per product after its screenshot: wait until no row waits
  // on a screenshot and the column has read the same five times running.
  let before: Record<string, string> = {};
  let steady = 0;
  await until(
    'the rows to settle',
    async () => {
      const now = await statuses();
      const same = JSON.stringify(now) === JSON.stringify(before);
      before = now;
      steady = same ? steady + 1 : 0;
      return steady >= 5 && !Object.values(now).some((t) => t.startsWith('screenshot not ready'));
    },
    90_000,
    1000,
  );
  const byKind = (k: Kind) => FIELDS.map((f) => f.name).filter((n) => kindOf(before[n]!) === k);
  measure('rows agreed before any click', `${byKind('agreed').length} of ${FIELDS.length}: ${byKind('agreed').join(', ') || '—'}`);
  measure('rows the same everywhere', `${byKind('same-everywhere').length}: ${byKind('same-everywhere').join(', ') || '—'}`);
  measure('rows that need you', `${byKind('needs-you').length}: ${byKind('needs-you').map((n) => `${n} (${before[n]})`).join('; ') || '—'}`);
  for (let i = 0; i < 3; i++) {
    const s = await statesOn(i);
    const suggested = Object.entries(s).filter(([, w]) => w === 'suggested').map(([n]) => n);
    measure(`product ${i + 1}, suggested`, `${suggested.length} of ${FIELDS.length}`);
  }
  const acceptAll = p.getByRole('button', { name: /^Accept all agreed \(\d+\)$/ });
  measure('the bar reads', norm(await acceptAll.innerText()));
  for (const s of suggested) for (const f of FIELDS) measure(`page data, capture ${s.captureId.slice(0, 8)}, ${f.name}`, s.fields[f.key] ?? '(not asked)');
  check('no screenshot is open before a click', (await panel().count()) === 0);
  await shootBoth('agreed');

  // ── Accept what agrees; look at the rest ──────────────────────────────────
  const verify = p.getByRole('button', { name: /^Verify/ });
  const how: string[] = [];
  const leftForAPerson = new Set<string>();
  for (let step = 0; step < 40; step++) {
    if (await verify.isEnabled()) break;
    const st = await statuses();
    const kinds = Object.fromEntries(Object.entries(st).map(([n, t]) => [n, kindOf(t)])) as Record<string, Kind>;
    if (Object.values(kinds).includes('agreed')) {
      const label = norm(await acceptAll.innerText());
      await click(() => acceptAll.click());
      how.push(label);
      await p.waitForTimeout(500);
      continue;
    }
    const same = FIELDS.find((f) => kinds[f.name] === 'same-everywhere');
    if (same) {
      // A value every product shows alike (Ikea's brand is IKEA): a person
      // reads it and accepts it with the second click the row asks for.
      await click(() => p.getByRole('button', { name: `Accept ${same.name} anyway`, exact: true }).click());
      how.push(`Accept ${same.name} anyway (${st[same.name]})`);
      await p.waitForTimeout(500);
      continue;
    }
    // A row that needs you: the product its reason names, else its first suggested cell.
    let acted = false;
    for (const f of FIELDS) {
      if (kinds[f.name] !== 'needs-you' || leftForAPerson.has(f.name)) continue;
      const named = /on product (\d)/.exec(st[f.name]!)?.[1];
      const order = [named ? Number(named) : 0, 1, 2, 3].filter((n) => n > 0);
      let target = 0;
      for (const n of order) if ((await cellState(f.name, n)) === 'suggested') { target = n; break; }
      if (!target) {
        leftForAPerson.add(f.name);
        continue;
      }
      const r = await tickCell(f.name, target);
      how.push(`${f.name} on product ${target}: ${r} (the row read "${st[f.name]}")`);
      if (r === 'nothing to tick') leftForAPerson.add(f.name);
      acted = true;
      break;
    }
    if (!acted) break;
  }
  for (const h of how) measure('clicked', h);
  if (leftForAPerson.size) measure('left for a person', [...leftForAPerson].map((n) => `${n} (${before[n]})`).join('; '));
  const cellsLeft: string[] = [];
  for (let i = 0; i < 3; i++) for (const [n, w] of Object.entries(await statesOn(i))) if (w !== 'accepted') cellsLeft.push(`${n} on product ${i + 1} (${w})`);
  measure('cells not accepted on products 1–3', cellsLeft.join(', ') || 'none');
  measure('transferMarks calls', `${transfers.length}`);
  const enabled = await until('Verify to be enabled', () => verify.isEnabled(), 10_000, 500);
  measure('CLICKS to an enabled Verify (Find products included)', enabled ? clicks : `${clicks} — and Verify is still off`);
  // The spec's target (2026-09-28 A5) is a measurement, not a pass mark: how
  // many rows need a person is the website's, not the tab's.
  measure('target: five clicks or fewer (plan 5 took 43)', enabled && clicks <= 5 ? 'met' : 'missed');
  check('Verify is enabled once every row is accepted', enabled, enabled ? '' : 'Verify is still off');
  if ((await panel().count()) > 0) await p.getByRole('button', { name: 'Close screenshot' }).click();

  // ── Verify, only if it is free ────────────────────────────────────────────
  const label = norm(await verify.innerText());
  // The disabled button's reason is the span beside it (spec: within one line).
  const reasonOf = async () => norm((await verify.locator('xpath=following-sibling::span[1]').innerText({ timeout: 1000 }).catch(() => '')) || '');
  await until('the last save', async () => (await p.getByText('saved', { exact: true }).count()) === 1, 15_000, 300);
  const reason = await reasonOf();
  measure('Verify reads', `${label}${reason ? ` — ${reason}` : ''}`);
  const free = /· free$/.test(label) && !label.includes('$');
  check('the Verify button says it is free', free, label);
  if (!free) throw new Error(`Verify does not read free ("${label}"); not clicking it`);

  if (enabled) {
    const started = Date.now();
    await verify.click();
    const settled = await until(
      'the verification',
      async () => {
        const rows = Object.values(await statuses());
        return rows.every((r) => !r.includes('checking…')) && rows.some((r) => /verified|fails on product|changed since verified/.test(r));
      },
      600_000,
      3000,
    );
    measure('verification took', seconds(Date.now() - started));
    check('the verification settles', settled);
    const badges = await statuses();
    const verified = Object.values(badges).filter((x) => x === 'verified').length;
    measure('badges', Object.entries(badges).map(([n, x]) => `${n}: ${x || 'no badge'}`).join(', '));
    check(`verified count`, true, `${verified} of ${FIELDS.length}`);
    const red = [];
    for (const f of FIELDS) for (let i = 1; i <= 3; i++) if ((await cellState(f.name, i)) === 'failed') red.push(`${f.name} on product ${i}`);
    measure('red cells', red.join(', ') || 'none');
    measure('Go to Extract', (await p.getByRole('link', { name: 'Go to Extract' }).count()) > 0 ? 'live' : 'locked');
    await shootBoth('verified');
  } else {
    measure('Verify stays off because', (await reasonOf()) || 'no reason shown');
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
