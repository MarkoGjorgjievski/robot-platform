// Look-only browser check of the new app's website screens (`@robot/app`, :3000),
// in both themes, against a real, fully verified website — the state plan 3's
// four tabs were built blind to, because a throwaway website has no verification,
// no run and no green cell anywhere.
//
// **It is read-only by construction.** It navigates, reads, measures and
// screenshots. It clicks no Verify / Re-verify / Sample / Extract / Check /
// "Find pages" / Save / Delete, opens no popover, types into no cell and changes
// no page, value, mode or budget. The one write it makes is the theme preference
// it needs to photograph both themes, and it puts that back in the `finally` at
// the bottom — the same bargain `ui-check-app-project.mts` strikes.
//
// That claim is enforced rather than asserted: every tRPC request the page makes
// is watched, the procedure names are collected (batched calls are split on the
// comma), and anything outside `ALLOWED` — the reads these screens issue on
// load, plus the sign-in and the theme — fails the run. The names actually seen
// are printed, so the evidence is in the output and not in this comment.
//
// Run from packages/browser so `playwright` resolves:
//   cp docs/testing/ui-check-app-site.mts packages/browser/src/__ui-check.mts \
//     && cd packages/browser && pnpm exec tsx src/__ui-check.mts --email <address> ; rm src/__ui-check.mts
//
// Options: `--email <address>` (required — this check is about somebody's real
// data), `--project <slug>` (default `acne`) and `--site <slug>` (default
// `ikea`). The ten captures Marko reviews go to
// `docs/testing/screens/app-site-{schema,schema-step1,extract,runs,settings}-<project>-<theme>.png`,
// resolved from packages/browser; `SCREENS_DIR` overrides that.
//
// The PASS/FAIL lines below are written against **Acne / Ikea**: 8 fields, three
// proof pages, every field certified, so the Schema grid is 24 green cells and
// the Extract tab is unlocked. What it does *not* have is a single extraction —
// so the Runs walk branches on `runs.listBySource` and says SKIP rather than
// passing a test that proves nothing. Run it against another website and the
// expectations to change are collected in `EXPECTED`.
//
// Needs the api-server (:4000) and the app (:3000) already running. Do not start
// or stop the user's dev servers.
import { chromium, type Page } from 'playwright';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const EMAIL = arg('email');
if (!EMAIL) {
  console.error("--email <address> is required: this check measures a real account's data.");
  process.exit(2);
}
const PROJECT = arg('project') ?? 'acne';
const SITE = arg('site') ?? 'ikea';
const SCREENS = process.env.SCREENS_DIR ?? '../../docs/testing/screens';
const APP = 'http://localhost:3000';
const API = 'http://localhost:4000';

/** What this website is expected to hold. Acne/Ikea's numbers; change these for another one. */
const EXPECTED = {
  breadcrumb: 'Markodjordjievski / Acne / Ikea',
  name: 'Ikea',
  fieldCount: 8,
  pageCount: 3,
  /** `stripSummary`'s `results` branch for a website where every field is current and none fails. */
  summary: '8 of 8 fields verified',
  /**
   * `verifyButton`'s `reverifyCount === 0` branch. A fully verified website whose
   * binding has not been touched since has nothing to re-verify, so the button
   * says so and is disabled — it only reads "Re-verify n fields · …" once a page,
   * a value or a hint has changed. Either way this check never presses it.
   */
  verifyLabel: 'Everything is verified',
  /** The three tab labels Extract's strip carries when the schema is green. */
  extractCells: ['Pages', 'Sample', 'Run'],
};

/** `listingModeLabel`, the one piece of copy this check has to know to compare the screen with the API. */
const MODE_LABEL: Record<string, string> = {
  listing_to_detail: 'Listing pages',
  detail: 'Product URLs',
};

/**
 * Everything this walk is allowed to ask the server for — an allow-list, not a
 * list of forbidden mutations, so the failure mode is "fails until somebody
 * looks" rather than "silently misses the mutation added last month".
 *
 * Derived from what the four tabs actually call on load, read off the routes:
 *
 * - the shell: `projects.get` (breadcrumb + sidebar) and `sources.get` (the
 *   layout query all four tabs and the breadcrumb share). `auth.me` is listed
 *   for completeness — today it is fetched by the app's server function, so it
 *   never shows up as a browser request.
 * - `projects.list`: the `/projects` landing page, which sign-in lands on
 *   before this check navigates to the website (`routes/_app/projects/index.tsx`
 *   — the command palette asks for it too, but only once opened, which this
 *   check never does). Observed on the first real run, 2026-09-23.
 * - Schema (`index.tsx`): `sources.verifyEstimate`, `sources.verificationStatus`.
 *   Step 1 is a panel over data already loaded and asks for nothing of its own.
 * - Extract (`extract.tsx`): `sources.verificationStatus`, `sources.inputRows`,
 *   `runs.listBySource`, and — only on a website that has a probe to show —
 *   `crawl.status`, `crawl.items`, `runs.getWithDetails` behind `ExtractSample`.
 * - Runs (`runs/index.tsx`) and Settings (`settings.tsx`): `runs.listBySource`.
 *
 * The two writes are here by name rather than by exception: `auth.signIn`,
 * which is how the check gets in, and `auth.setTheme`, which is the one write
 * to the account and is restored in the `finally`. Anything else — any of the
 * mutations these tabs can fire, or a read a new tab adds — fails the run and
 * is printed.
 */
const ALLOWED = [
  'auth.me',
  'auth.signIn',
  'auth.setTheme',
  'projects.get',
  'projects.list',
  'sources.get',
  'sources.verifyEstimate',
  'sources.verificationStatus',
  'sources.inputRows',
  'runs.listBySource',
  'runs.getWithDetails',
  'crawl.status',
  'crawl.items',
];

type Preference = 'dark' | 'light' | 'system';
const PREFERENCE_LABEL: Record<Preference, string> = { dark: 'Dark', light: 'Light', system: 'System' };

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};
const measure = (name: string, value: string) => console.log(`      ${name}: ${value}`);

const b = await chromium.launch({ headless: true });
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

/** Every tRPC procedure this session has asked for, in the order first seen. */
const called: string[] = [];
p.on('request', (r) => {
  const m = /\/trpc\/([^?]+)/.exec(r.url());
  if (!m) return;
  for (const name of decodeURIComponent(m[1]!).split(',')) {
    if (name && !called.includes(name)) called.push(name);
  }
});

/**
 * `animations: 'disabled'` matters: the page-load `.rise` starts at `opacity: 0`
 * with `animation-fill-mode: both`, and a headless browser starts a CSS animation
 * only on its first rendered frame — the one the screenshot itself provokes. A
 * capture straight after a navigation would photograph the *from* keyframe, an
 * empty page. Disabled, finite animations are fast-forwarded to their end and the
 * pulsing dot is frozen, so every capture is stable.
 *
 * The pointer is parked in the bottom-right corner first. Playwright keeps the
 * virtual mouse wherever the last click left it — the theme menu — and after a
 * navigation that lands somewhere in the middle of the grid, so a capture would
 * otherwise photograph one arbitrary row wearing its hover hairlines.
 */
const shoot = async (dir: string, file: string, fullPage = true) => {
  await p.mouse.move(1435, 895);
  await p.screenshot({ path: `${dir}/${file}`, fullPage, animations: 'disabled' });
};

/** React tags hydrated host nodes with `__reactProps$…`; reading before that is reading a shell. */
async function hydrated(selector: string) {
  await p.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps$'));
    },
    selector,
    { timeout: 20_000 },
  );
}

async function signIn() {
  await p.goto(`${APP}/login`, { waitUntil: 'networkidle' });
  await hydrated('#email');
  await p.locator('#email').fill(EMAIL!);
  await p.locator('#password').fill('check');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL(`${APP}/projects`, { timeout: 30_000 });
}

async function cookieHeader(): Promise<string> {
  const cookies = await ctx.cookies(API);
  return cookies.filter((c) => c.name === 'robot_session').map((c) => `${c.name}=${c.value}`).join('; ');
}

/** A tRPC query over HTTP with this session's cookie. A query, so a GET: nothing is written. */
async function query<T>(path: string, input: unknown): Promise<T> {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const res = await fetch(`${API}/trpc/${path}?input=${encoded}`, { headers: { cookie: await cookieHeader() } });
  const body = (await res.json()) as { result?: { data?: { json?: T } } };
  const data = body.result?.data?.json;
  if (data === undefined) throw new Error(`${path} did not answer: ${JSON.stringify(body).slice(0, 200)}`);
  return data;
}

/** The stored preference (`dark | light | system`), which is not the same as the rendered theme. */
async function storedPreference(): Promise<Preference> {
  const res = await fetch(`${API}/trpc/auth.me`, { headers: { cookie: await cookieHeader() } });
  const body = (await res.json()) as { result?: { data?: { json?: { user?: { theme?: Preference } } } } };
  return body.result?.data?.json?.user?.theme ?? 'dark';
}

/** User menu → Theme → one of the three radio items. The only write this check makes. */
async function choosePreference(pref: Preference) {
  await p.locator('aside button').filter({ hasText: EMAIL! }).first().click();
  await p.getByRole('menuitem', { name: 'Theme' }).click();
  const saved = p.waitForResponse((r) => r.url().includes('auth.setTheme'), { timeout: 15_000 }).catch(() => null);
  await p.getByRole('menuitemradio', { name: PREFERENCE_LABEL[pref] }).click();
  await saved;
  await p.keyboard.press('Escape');
}

/** Choose a theme and wait for the server to agree — a reload is what proves it. */
async function setTheme(theme: 'dark' | 'light') {
  await choosePreference(theme);
  for (let i = 0; i < 20; i++) {
    await p.reload({ waitUntil: 'networkidle' });
    if ((await p.evaluate(() => document.documentElement.dataset.theme)) === theme) return true;
    await p.waitForTimeout(400);
  }
  return false;
}

/** Everything with a visible `text-transform: uppercase` (spec §4: sentence case everywhere). */
const uppercaseElements = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('*')]
      .filter((el) => getComputedStyle(el).textTransform === 'uppercase' && (el.textContent ?? '').trim() !== '')
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80)),
  );

/**
 * Everything with a real box-shadow (spec §4: none in dark — the hairline is the
 * depth). Inset shadows are excluded: a sticky table head under `border-collapse`
 * cannot use a border, so `[box-shadow:inset_0_-1px_0_var(--border)]` is this
 * system's border stand-in, not a lift.
 */
const shadowedElements = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('*')]
      .filter((el) => {
        const s = getComputedStyle(el).boxShadow;
        if (s === 'none' || s === '' || s.startsWith('rgba(0, 0, 0, 0) 0px 0px 0px 0px')) return false;
        return !s.includes('inset');
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80)),
  );

/**
 * What a token resolves to *in this theme*, read off a throwaway element wearing
 * the utility class the component uses. Comparing against a hex literal would
 * only prove the literal was copied correctly; this compares against the class.
 */
const tokenColour = (page: Page, className: string) =>
  page.evaluate((cls) => {
    const el = document.createElement('span');
    el.className = `border-l-2 ${cls}`;
    document.body.appendChild(el);
    const colour = getComputedStyle(el).borderLeftColor;
    el.remove();
    return colour;
  }, className);

/** The measurements spec §4 fixes, asked on every screen. */
async function shellMeasurements(label: string, theme: 'dark' | 'light') {
  const bodyFont = await p.evaluate(() => getComputedStyle(document.body).fontSize);
  check(`${label}: body font-size is 13 px`, bodyFont === '13px', bodyFont);

  const title = await p.locator('h1').evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: s.fontSize, weight: s.fontWeight };
  });
  check(`${label}: page title is 20 px`, title.size === '20px', `${title.size} / ${title.weight}`);

  const tabs = await p.locator('nav[aria-label="Website"] a').count();
  check(`${label}: the website's four tabs are there`, tabs === 4, `${tabs}`);

  const upper = await uppercaseElements(p);
  check(`${label}: nothing is uppercased`, upper.length === 0, upper.join(', '));

  if (theme === 'dark') {
    const shadows = await shadowedElements(p);
    check(`${label}: nothing casts a shadow in dark`, shadows.length === 0, shadows.join(', '));
  }
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

await signIn();

// Switching the theme writes to this account's user row, and given a real
// address that is somebody's actual preference. It is read here and put back in
// the `finally` at the bottom: the check must leave the account as it found it.
const originalPreference = await storedPreference();
console.log(`stored theme preference on arrival: ${originalPreference}`);
console.log(`website: /projects/${PROJECT}/sites/${SITE}   account: ${EMAIL}`);

const BASE = `${APP}/projects/${PROJECT}/sites/${SITE}`;

try {

// The website's own row, from the same query every tab reads, taken once before
// the walk. The screens are then compared against *this* rather than against
// themselves: a Settings row that agrees with the API is a Settings row that is
// right, and one that agrees only with itself proves nothing.
const site = await query<{
  id: string;
  name: string;
  url: string | null;
  listingMode: string | null;
  confirmedAt: string | null;
  budget: { max_items: number | 'all'; max_pages: number | 'all' } | null;
  fields: Array<{ key: string; name: string }>;
  verificationSet: { urls?: string[] } | null;
}>('sources.get', { projectSlug: PROJECT, sourceSlug: SITE });
const runs = await query<Array<{ id: string; status: string }>>('runs.listBySource', { sourceId: site.id });
const pageCount = site.verificationSet?.urls?.length ?? 0;
console.log(
  `sources.get: ${site.fields.length} fields, ${pageCount} proof pages, listing mode ${site.listingMode ?? '—'}, ` +
    `budget ${site.budget ? JSON.stringify(site.budget) : 'not chosen'}, confirmed ${site.confirmedAt ?? 'no'}`,
);
console.log(`runs.listBySource: ${runs.length} extraction(s)`);

for (const theme of ['dark', 'light'] as const) {
  console.log(`\n── ${theme} ──`);
  check(`theme switches to ${theme} and the server renders it`, await setTheme(theme));

  // ── Schema ────────────────────────────────────────────────────────────────
  errors = [];
  const schema = await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  check('schema renders', !!schema?.ok() && (await p.locator('h1').count()) > 0, `HTTP ${schema?.status()}`);

  const crumbs = norm(await p.locator('nav[aria-label="Breadcrumb"]').innerText());
  check(`breadcrumb reads "${EXPECTED.breadcrumb}"`, crumbs === EXPECTED.breadcrumb, crumbs);

  // The strip's own sentence — `stripSummary`'s results branch.
  const summary = norm(await p.locator('[role="status"] p').first().innerText());
  check(`the strip reads "${EXPECTED.summary}"`, summary === EXPECTED.summary, summary);

  // The grid: one row per field, one column per proof page, and a rail on every
  // cell where they meet.
  const rows = await p.locator('tbody tr').count();
  const heads = await p.locator('thead th').count();
  check(`the grid has ${EXPECTED.fieldCount} field rows`, rows === EXPECTED.fieldCount, `${rows}`);
  check(
    `and ${EXPECTED.pageCount} page columns beside Field, Type and the hint`,
    heads === 3 + EXPECTED.pageCount,
    `${heads} heads`,
  );

  // `td` index 3 onward is a page column; each holds one `div` carrying the rail.
  const rails = await p.evaluate(() =>
    [...document.querySelectorAll('tbody tr')].flatMap((tr) =>
      [...tr.children].slice(3).map((td) => {
        const box = td.querySelector('div');
        return box ? getComputedStyle(box).borderLeftColor : 'no rail';
      }),
    ),
  );
  const pass = await tokenColour(p, 'border-pass');
  const green = rails.filter((c) => c === pass).length;
  check(
    `every one of the ${rails.length} cells wears the pass rail`,
    rails.length === EXPECTED.fieldCount * EXPECTED.pageCount && green === rails.length,
    `${green} of ${rails.length} = ${pass}; others: ${[...new Set(rails.filter((c) => c !== pass))].join(', ') || 'none'}`,
  );
  measure('cell second lines', [...new Set(await p.locator('tbody td p').allInnerTexts())].map(norm).filter(Boolean).join(' | '));

  // Read, never pressed: a verification is the one control on this screen that
  // can cost money.
  const verifyLabel = norm(await p.getByRole('button', { name: /^(Verify|Re-verify|Everything is verified)/ }).first().innerText());
  check(`the Verify button reads "${EXPECTED.verifyLabel}"`, verifyLabel === EXPECTED.verifyLabel, verifyLabel);

  // Green means the way on is a real link rather than a disabled button.
  const extractLink = await p.getByRole('link', { name: 'Go to Extract' }).count();
  check('Go to Extract is a live link', extractLink === 1, `${extractLink} link(s)`);

  await shellMeasurements('schema', theme);
  check('schema logs nothing', errors.length === 0, errors.join(' | '));
  await shoot(SCREENS, `app-site-schema-${PROJECT}-${theme}.png`);

  // ── Schema, step 1 ────────────────────────────────────────────────────────
  // The stepper's first step is a whole screen of the design review with no
  // capture otherwise: `?step=fields` is in the URL by design (index.tsx:37 —
  // "which step is open lives in the URL"), the panel it opens is a read of
  // fields already loaded, and nothing on it is clicked here.
  errors = [];
  const step1 = await p.goto(`${BASE}?step=fields`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  check('schema step 1 renders', !!step1?.ok() && (await p.locator('h1').count()) > 0, `HTTP ${step1?.status()}`);
  const step1Body = norm(await p.locator('main').innerText());
  check(
    `step 1 lists the ${EXPECTED.fieldCount} fields and offers Edit fields`,
    step1Body.includes(`${EXPECTED.fieldCount} fields`) && step1Body.includes('Edit fields'),
    step1Body.slice(0, 120),
  );
  check('and the grid is not on screen', (await p.locator('tbody tr').count()) === 0);
  check('schema step 1 logs nothing', errors.length === 0, errors.join(' | '));
  await shoot(SCREENS, `app-site-schema-step1-${PROJECT}-${theme}.png`);

  // ── Extract ───────────────────────────────────────────────────────────────
  errors = [];
  const extract = await p.goto(`${BASE}/extract`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  check('extract renders', !!extract?.ok() && (await p.locator('h1').count()) > 0, `HTTP ${extract?.status()}`);

  const extractBody = norm(await p.locator('main').innerText());
  check('the tab is not locked', !extractBody.includes('Extraction is locked'), extractBody.slice(0, 120));
  check('and nothing on it is out of reach', (await p.locator('main [inert]').count()) === 0);
  const cells = (await p.locator('[role="listitem"]').allInnerTexts()).map(norm);
  check(
    `the strip carries ${EXPECTED.extractCells.join(', ')}`,
    EXPECTED.extractCells.every((t, i) => (cells[i] ?? '').includes(t)),
    cells.join(' | '),
  );

  await shellMeasurements('extract', theme);
  check('extract logs nothing', errors.length === 0, errors.join(' | '));
  await shoot(SCREENS, `app-site-extract-${PROJECT}-${theme}.png`);

  // ── Runs ──────────────────────────────────────────────────────────────────
  errors = [];
  const runsPage = await p.goto(`${BASE}/runs`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  check('runs renders', !!runsPage?.ok() && (await p.locator('h1').count()) > 0, `HTTP ${runsPage?.status()}`);

  const tableRows = await p.locator('tbody tr').count();
  if (runs.length > 0) {
    check('the table lists every extraction', tableRows === runs.length, `${tableRows} rows vs ${runs.length} from the API`);
    const first = norm(await p.locator('tbody tr').first().innerText());
    measure('newest row', first);
    check('each row links to its own extraction', (await p.locator('tbody a').count()) === runs.length);
  } else {
    // Nothing on this website has ever been extracted, and extracting costs
    // money — so the empty state is this tab's true state, and the populated
    // table cannot be photographed here without spending. Said out loud rather
    // than passed off as a test.
    check('runs shows its empty state', (await p.locator('main').innerText()).includes('No extractions yet'), '');
    check('no table is drawn over nothing', tableRows === 0, `${tableRows} rows`);
    measure('runs', 'SKIP — no extraction on this website, so there is no table and no run page to measure');
  }

  await shellMeasurements('runs', theme);
  check('runs logs nothing', errors.length === 0, errors.join(' | '));
  await shoot(SCREENS, `app-site-runs-${PROJECT}-${theme}.png`);

  // ── Settings ──────────────────────────────────────────────────────────────
  errors = [];
  const settings = await p.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  check('settings renders', !!settings?.ok() && (await p.locator('h1').count()) > 0, `HTTP ${settings?.status()}`);

  const nameRow = await p.getByRole('textbox', { name: 'Name', exact: true }).inputValue();
  check(`the Name row reads "${site.name}"`, nameRow === site.name, nameRow);

  const rowText = norm(await p.locator('dl').innerText());
  check('the Address row is the website\'s own url', site.url !== null && rowText.includes(site.url), site.url ?? '—');

  const mode = norm(await p.locator('button[aria-label="Listing mode"]').innerText());
  const expectedMode = site.listingMode ? MODE_LABEL[site.listingMode]! : 'Not chosen yet';
  check(`Listing mode reads what sources.get returns ("${expectedMode}")`, mode === expectedMode, mode);
  // Confirmed websites cannot change shape any more, and the reason has to be
  // beside the control that is off.
  const modeDisabled = await p.locator('button[aria-label="Listing mode"]').isDisabled();
  check(
    site.confirmedAt ? 'and is locked, because the website is confirmed' : 'and is still choosable',
    modeDisabled === !!site.confirmedAt,
    `disabled=${modeDisabled}, confirmedAt=${site.confirmedAt ?? 'null'}`,
  );

  const items = norm(await p.locator('button[aria-label="How many products"]').innerText());
  const pages = norm(await p.locator('button[aria-label="How many pages"]').innerText());
  const expectedItems = site.budget === null || site.budget.max_items === 'all' ? 'all' : 'custom';
  const expectedPages = site.budget === null || site.budget.max_pages === 'all' ? 'all' : 'custom';
  check(
    `Budget reads what sources.get returns (${expectedItems} products / ${expectedPages} pages)`,
    items === expectedItems && pages === expectedPages,
    `${items} / ${pages}`,
  );
  measure('budget sentence', norm(await p.locator('dl p').first().innerText()));

  // Present and legible — never pressed. Deleting Ikea would take Acne's only
  // verified website with it.
  const del = p.getByRole('button', { name: 'Delete website' });
  check('the Danger zone offers Delete website', (await del.count()) === 1 && (await del.isEnabled()));

  await shellMeasurements('settings', theme);
  check('settings logs nothing', errors.length === 0, errors.join(' | '));
  await shoot(SCREENS, `app-site-settings-${PROJECT}-${theme}.png`);
}

} finally {
  // ── What this check actually asked the server for ─────────────────────────
  // In the `finally`, not above it: this is the check's own safety assertion,
  // and an assertion whose job is to prove nothing was written is worth the
  // most on the run that threw half way through. Skipping it there would leave
  // the one path where something unexpected happened with no evidence at all.
  console.log('\n── the calls this check made ──');
  {
    const unexpected = called.filter((name) => !ALLOWED.includes(name));
    check('nothing outside the reads this check expects', unexpected.length === 0, unexpected.join(', '));
    measure('procedures called', [...called].sort().join(', '));
    measure('the one write', 'auth.setTheme, restored below');
  }

  // Put the preference back, whatever happened above.
  const now = await storedPreference().catch(() => null);
  if (now === null) {
    // The API did not answer, so this check cannot say what the account's
    // preference is now — and it has been writing to it. Saying "unchanged"
    // here would be a claim about somebody's real row that nothing has
    // verified; a lying log is worse than no log.
    console.error(
      `theme preference COULD NOT BE VERIFIED OR RESTORED: auth.me is unreachable. It was ${originalPreference} on arrival; this check has since set it, so it may be dark or light now. Set it back by hand.`,
    );
  } else if (now !== originalPreference) {
    await choosePreference(originalPreference).catch((err) => console.error('could not restore the theme preference:', err));
    console.log(`theme preference restored: ${now} -> ${await storedPreference().catch(() => '?')}`);
  } else {
    console.log(`theme preference unchanged: ${originalPreference}`);
  }
  // Inside the `finally`: a throw above would otherwise leak a chromium process.
  await b.close();
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
