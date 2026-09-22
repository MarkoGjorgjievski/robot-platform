// Look-only browser check of the new app's project screens (`@robot/app`, :3000),
// in both themes, against a real project — the one plan 2's screens were built
// blind to, because a throwaway project has no verification, no run and no rows.
//
// **It is read-only by construction.** It navigates, reads, measures and
// screenshots. It clicks no catalogue chip, submits no dialog, renames nothing,
// deletes nothing, changes no field's type. The one write it makes is the theme
// preference it needs to photograph both themes, and it puts that back in the
// `finally` at the bottom — the same bargain `ui-check-app-shell.mts` strikes.
// The download check is a `GET` of the CSV URL whose headers it reads and whose
// body it cancels; the export route is a read.
//
// Run from packages/browser so `playwright` resolves:
//   cp docs/testing/ui-check-app-project.mts packages/browser/src/__ui-check.mts \
//     && cd packages/browser && pnpm exec tsx src/__ui-check.mts --email <address> ; rm src/__ui-check.mts
//
// Options: `--email <address>` (required — this check is about somebody's real
// data) and `--project <slug>` (default `acne`). The six captures Marko reviews
// go to `docs/testing/screens/app-project-{home,fields,output}-<project>-<theme>.png`,
// resolved from packages/browser; `SCREENS_DIR` overrides that. It also retakes
// `app-projects-{dark,light}.png` on the way past, because every smoke run
// overwrites those with a throwaway organisation's empty table and this is the
// only check that sees that screen as a real account.
//
// The PASS/FAIL lines below are written against **Acne**: 8 fields, one website
// (Ikea), every field certified, one completed run. Run it against another
// project and the expectations to change are collected in `EXPECTED`.
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
  console.error('--email <address> is required: this check measures a real account\'s data.');
  process.exit(2);
}
const PROJECT = arg('project') ?? 'acne';
const SCREENS = process.env.SCREENS_DIR ?? '../../docs/testing/screens';
const APP = 'http://localhost:3000';
const API = 'http://localhost:4000';

/** What this project is expected to hold. Acne's numbers; change these for another project. */
const EXPECTED = {
  breadcrumb: 'Markodjordjievski / Acne',
  website: 'Ikea',
  verified: 'All 8 verified',
  fieldCount: 8,
  /** With one website every field reads the singular — `verifiedLabel` counts its own noun. */
  verifiedOn: '1 of 1 website',
  /** The download's filename starts with the project slug. */
  filePrefix: `${PROJECT}-`,
};

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

/**
 * `animations: 'disabled'` matters: the page-load `.rise` starts at `opacity: 0`
 * with `animation-fill-mode: both`, and a headless browser starts a CSS animation
 * only on its first rendered frame — the one the screenshot itself provokes. A
 * capture straight after a navigation would photograph the *from* keyframe, an
 * empty page. Disabled, finite animations are fast-forwarded to their end and the
 * pulsing dot is frozen, so every capture is stable.
 */
const shoot = (dir: string, file: string, fullPage = true) =>
  p.screenshot({ path: `${dir}/${file}`, fullPage, animations: 'disabled' });

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

/** The stored preference (`dark | light | system`), which is not the same as the rendered theme. */
async function storedPreference(): Promise<Preference> {
  const cookies = await ctx.cookies(API);
  const cookie = cookies.filter((c) => c.name === 'robot_session').map((c) => `${c.name}=${c.value}`).join('; ');
  const res = await fetch(`${API}/trpc/auth.me`, { headers: { cookie } });
  const body = (await res.json()) as { result?: { data?: { json?: { user?: { theme?: Preference } } } } };
  return body.result?.data?.json?.user?.theme ?? 'dark';
}

/**
 * `projects.output` over HTTP with this session's cookie — the same query the
 * Output screen runs, read here for the project's id and its column order. A
 * query, so a GET: nothing is written.
 */
async function readOutput(): Promise<{ project: { id: string; slug: string }; fields: string[]; rowCount: number }> {
  const cookies = await ctx.cookies(API);
  const cookie = cookies.filter((c) => c.name === 'robot_session').map((c) => `${c.name}=${c.value}`).join('; ');
  const input = encodeURIComponent(JSON.stringify({ json: { projectSlug: PROJECT } }));
  const res = await fetch(`${API}/trpc/projects.output?input=${input}`, { headers: { cookie } });
  const body = (await res.json()) as { result?: { data?: { json?: { project: { id: string; slug: string }; fields: string[]; rowCount: number } } } };
  const data = body.result?.data?.json;
  if (!data) throw new Error(`projects.output did not answer: ${JSON.stringify(body).slice(0, 200)}`);
  return data;
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

/** Everything with a real box-shadow (spec §4: none in dark — the hairline is the depth). */
const shadowedElements = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('*')]
      .filter((el) => {
        const s = getComputedStyle(el).boxShadow;
        return s !== 'none' && s !== '' && !s.startsWith('rgba(0, 0, 0, 0) 0px 0px 0px 0px');
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
console.log(`project: /projects/${PROJECT}   account: ${EMAIL}`);

/** Filled by the Output walk, so the download check runs once, outside the loop. */
let csvUrl: string | null = null;

try {

for (const theme of ['dark', 'light'] as const) {
  console.log(`\n── ${theme} ──`);
  check(`theme switches to ${theme} and the server renders it`, await setTheme(theme));

  // ── The project home ──────────────────────────────────────────────────────
  errors = [];
  const home = await p.goto(`${APP}/projects/${PROJECT}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  check('home renders', !!home?.ok() && (await p.locator('h1').count()) > 0, `HTTP ${home?.status()}`);

  const crumbs = norm(await p.locator('nav[aria-label="Breadcrumb"]').innerText());
  check(`breadcrumb reads "${EXPECTED.breadcrumb}"`, crumbs === EXPECTED.breadcrumb, crumbs);

  // The sidebar's project section: the website as a plain row with its dot.
  const siteRow = p.locator('aside li').filter({ hasText: EXPECTED.website });
  const siteDot = siteRow.locator('span[role="img"]');
  check(
    `the sidebar lists ${EXPECTED.website} with a dot`,
    (await siteRow.count()) === 1 && (await siteDot.count()) === 1,
    `${await siteRow.count()} row(s), ${await siteDot.count()} dot(s), dot: ${await siteDot.first().getAttribute('aria-label')}`,
  );

  // The Verified cell: the label, and the 2 px rail that has to be the pass token.
  const rail = p.locator('tbody tr').first().locator('td').nth(1).locator('span').first();
  const verified = norm(await rail.innerText());
  const railColour = await rail.evaluate((el) => getComputedStyle(el).borderLeftColor);
  const pass = await tokenColour(p, 'border-pass');
  check(`the Verified cell reads "${EXPECTED.verified}"`, verified === EXPECTED.verified, verified);
  check('its rail is the pass token', railColour === pass, `${railColour} vs ${pass}`);

  await shellMeasurements('home', theme);
  check('home logs nothing', errors.length === 0, errors.join(' | '));
  await shoot(SCREENS, `app-project-home-${PROJECT}-${theme}.png`);

  // ── Fields ────────────────────────────────────────────────────────────────
  errors = [];
  const fields = await p.goto(`${APP}/projects/${PROJECT}/fields`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  check('fields renders', !!fields?.ok() && (await p.locator('h1').count()) > 0, `HTTP ${fields?.status()}`);

  const rows = p.locator('tbody tr');
  check(`fields lists ${EXPECTED.fieldCount} rows`, (await rows.count()) === EXPECTED.fieldCount, `${await rows.count()}`);

  // `td:nth-child(3)` and not `.locator('td').nth(2)`: chaining flattens across
  // every row, so `nth(2)` would be the third cell of the *table*, not one per row.
  const verifiedOn = await rows.locator('td:nth-child(3)').allInnerTexts();
  const allVerifiedOn = verifiedOn.every((t) => norm(t) === EXPECTED.verifiedOn);
  check(
    `every field's Verified on reads "${EXPECTED.verifiedOn}"`,
    allVerifiedOn && verifiedOn.length === EXPECTED.fieldCount,
    [...new Set(verifiedOn.map(norm))].join(' | '),
  );

  // A certified field cannot be retyped, and every field here is certified.
  const selects = p.locator('tbody button[aria-label^="Type of"]');
  const disabled = await selects.evaluateAll((els) => els.filter((el) => (el as HTMLButtonElement).disabled).length);
  check(
    'every type select is disabled',
    (await selects.count()) === EXPECTED.fieldCount && disabled === EXPECTED.fieldCount,
    `${disabled} of ${await selects.count()} disabled`,
  );

  await shellMeasurements('fields', theme);
  check('fields logs nothing', errors.length === 0, errors.join(' | '));
  await shoot(SCREENS, `app-project-fields-${PROJECT}-${theme}.png`);

  // ── Output ────────────────────────────────────────────────────────────────
  errors = [];
  const output = await p.goto(`${APP}/projects/${PROJECT}/output`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  check('output renders', !!output?.ok() && (await p.locator('h1').count()) > 0, `HTTP ${output?.status()}`);

  const columns = await p.locator('thead th').count();
  const outputRows = await p.locator('tbody tr').count();
  const links = await p.locator('main a[download]').evaluateAll((els) =>
    els.map((el) => (el as HTMLAnchorElement).href),
  );
  const shape = /\/export\/projects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(csv|json)$/;

  if (columns > 0) {
    const firstColumn = norm(await p.locator('thead th').first().innerText());
    check('the first column is Website', firstColumn === 'Website', firstColumn);
    check('the sheet has rows', outputRows > 0, `${outputRows} rows`);
    measure('output', `${columns} columns, ${outputRows} rows`);
    check(
      'both downloads point at /export/projects/<uuid>.<ext>',
      links.length === 2 && links.every((href) => shape.test(href)),
      links.join(' '),
    );
    csvUrl = links.find((href) => href.endsWith('.csv')) ?? csvUrl;
  } else {
    // No website in this database has ever completed a run — an Extract has
    // never been clicked — so the empty state is this screen's true state, and
    // the sheet cannot be checked without spending money. What can be checked
    // is that the screen is honest about it: one sentence, and two downloads
    // that are buttons rather than links to an empty file. The column order and
    // the file itself are asked of the API below instead.
    const body = norm(await p.locator('main').innerText());
    check('output shows its empty state', body.includes('No rows yet'), body.slice(0, 120));
    const disabled = await p.locator('main button:disabled').count();
    check('the downloads are disabled, with no file behind them', links.length === 0 && disabled === 2, `${links.length} link(s), ${disabled} disabled button(s)`);
    measure('output', 'SKIP — no completed run in this database, so there is no sheet to measure');
  }

  await shellMeasurements('output', theme);
  check('output logs nothing', errors.length === 0, errors.join(' | '));
  await shoot(SCREENS, `app-project-output-${PROJECT}-${theme}.png`);

  // ── /projects, retaken ────────────────────────────────────────────────────
  // Plan 1's review captures of the projects table are overwritten by every
  // smoke run, which sees a throwaway organisation with one empty project. This
  // check is the only thing that visits that screen as a real account, so it
  // puts the real ones back rather than leaving the committed files showing a
  // smoke run's furniture. It reads; nothing on that screen is clicked.
  await p.goto(`${APP}/projects`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const listed = await p.locator('tbody tr').count();
  check('/projects lists this account\'s projects', listed > 0, `${listed} rows`);
  await shoot(SCREENS, `app-projects-${theme}.png`);
}

// ── The file itself ─────────────────────────────────────────────────────────
// A read: the response's headers are what is inspected, and the body is
// cancelled rather than downloaded.
console.log('\n── the download ──');
{
  // With no run, the Output screen offers no link — so the project's own id and
  // its column order come from `projects.output`, the query the screen runs.
  const out = await readOutput();
  check('the first column of the file is Website', out.fields[0] === 'Website', out.fields.slice(0, 4).join(', '));
  measure('projects.output', `${out.fields.length} columns, ${out.rowCount} rows, project ${out.project.id}`);

  const url = csvUrl ?? `${API}/export/projects/${out.project.id}.csv`;
  if (!csvUrl) console.log('      the URL is built from projects.output: the screen shows no link with no rows');
  const res = await fetch(url);
  const disposition = res.headers.get('content-disposition') ?? '';
  await res.body?.cancel();
  check('the CSV responds 200', res.status === 200, `${res.status} ${url}`);
  check(
    `content-disposition names "${EXPECTED.filePrefix}…"`,
    disposition.includes(`filename="${EXPECTED.filePrefix}`),
    disposition,
  );
  measure('content-type', res.headers.get('content-type') ?? '—');
  // The route takes no session: that is the point being recorded, not a defect
  // this check found — plan 6 puts both export routes behind the session.
  measure('auth', 'none — the export route is unauthenticated by project UUID (spec §7, plan 6)');
}

} finally {
  // Put the preference back, whatever happened above.
  const now = await storedPreference().catch(() => null);
  if (now !== null && now !== originalPreference) {
    await choosePreference(originalPreference).catch((err) => console.error('could not restore the theme preference:', err));
    console.log(`theme preference restored: ${now} -> ${await storedPreference().catch(() => '?')}`);
  } else {
    console.log(`theme preference unchanged: ${originalPreference}`);
  }
}

await b.close();
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
