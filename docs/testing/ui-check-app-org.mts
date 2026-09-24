// Look-only browser check of the new app's organisation screens (`@robot/app`,
// :3000), in both themes, against a real account's real organisation — the
// state plan 4's four screens were built blind to, because a throwaway
// organisation has no other members, no spend and (usually) no run.
//
// **It is read-only by construction.** It navigates, reads, measures and
// screenshots. It clicks no Save, Remove or Delete organisation, opens no
// dialog and types into no field. The one write it makes is the theme
// preference it needs to photograph both themes, and it puts that back in the
// `finally` at the bottom — the same bargain `ui-check-app-site.mts` strikes.
//
// That claim is enforced rather than asserted: every tRPC request the page
// makes is watched, the procedure names are collected (batched calls are
// split on the comma), and anything outside `ALLOWED` — the reads these four
// screens issue on load, plus the sign-in and the theme — fails the run. The
// names actually seen are printed, so the evidence is in the output and not
// in this comment.
//
// Run from packages/browser so `playwright` resolves:
//   cp docs/testing/ui-check-app-org.mts packages/browser/src/__ui-check.mts \
//     && cd packages/browser && pnpm exec tsx src/__ui-check.mts --email <address> ; rm src/__ui-check.mts
//
// Options: `--email <address>` (required — this check is about somebody's
// real data). The eight captures go to
// `docs/testing/screens/app-org-{runs,usage,settings,account}-<theme>.png`,
// resolved from packages/browser; `SCREENS_DIR` overrides that.
//
// Unlike `ui-check-app-site.mts` there is no fixed `EXPECTED` object: an
// organisation's members, spend and runs are the account's own, not a
// designed-for state, so every screen is compared against what the API
// itself returns for that account (`auth.me`, `orgs.members.list`,
// `runs.listByOrg`, `usage.byProject`) rather than against numbers written
// into this file. The one branch that matters is `/runs`: a throwaway
// organisation has never run anything, so that walk says SKIP rather than
// passing a test that proves nothing — the same shape as the Runs branch in
// `ui-check-app-site.mts`.
//
// Needs the api-server (:4000) and the app (:3000) already running. Do not
// start or stop the user's dev servers.
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
const SCREENS = process.env.SCREENS_DIR ?? '../../docs/testing/screens';
const APP = 'http://localhost:3000';
const API = 'http://localhost:4000';

/**
 * Everything this walk is allowed to ask the server for — an allow-list, not
 * a list of forbidden mutations, so the failure mode is "fails until somebody
 * looks" rather than "silently misses the mutation added last month".
 *
 * Derived from what the four screens actually call on load:
 *
 * - the shell: `projects.list`, fired by the `/projects` landing page sign-in
 *   lands on before this check navigates anywhere else, and again by
 *   Settings' own danger-zone project count. `auth.me` is listed for
 *   completeness — today it is fetched by the app's server function, so it
 *   never shows up as a browser request.
 * - `/runs` (`runs.tsx`): `runs.listByOrg`.
 * - `/usage` (`usage.tsx`): `usage.byProject`.
 * - `/settings` (`settings.tsx`): `projects.list`, and `orgs.members.list`
 *   from `MembersTable`.
 * - `/account` (`account.tsx`): nothing of its own — `ProfilePanel` and
 *   `AppearancePanel` render the session already loaded.
 *
 * The two writes are here by name rather than by exception: `auth.signIn`,
 * which is how the check gets in, and `auth.setTheme`, which is the one
 * write to the account and is restored in the `finally`. Anything else — any
 * of the mutations these screens can fire (`orgs.rename`, `orgs.delete`,
 * `orgs.members.setRole`, `orgs.members.remove`, `auth.updateName`), or a
 * read a new screen adds — fails the run and is printed.
 */
const ALLOWED = ['auth.me', 'auth.signIn', 'auth.setTheme', 'projects.list', 'runs.listByOrg', 'usage.byProject', 'orgs.members.list'];

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
 * navigation that lands somewhere in the middle of a table, so a capture would
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

/** The measurements spec §4 fixes, asked on every screen. */
async function shellMeasurements(label: string, theme: 'dark' | 'light') {
  const bodyFont = await p.evaluate(() => getComputedStyle(document.body).fontSize);
  check(`${label}: body font-size is 13 px`, bodyFont === '13px', bodyFont);

  const title = await p.locator('h1').evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: s.fontSize, weight: s.fontWeight };
  });
  check(`${label}: page title is 20 px`, title.size === '20px', `${title.size} / ${title.weight}`);

  const nav = await p.locator('aside nav a').count();
  check(`${label}: the sidebar's four links are there`, nav === 4, `${nav}`);

  const upper = await uppercaseElements(p);
  check(`${label}: nothing is uppercased`, upper.length === 0, upper.join(', '));

  if (theme === 'dark') {
    const shadows = await shadowedElements(p);
    check(`${label}: nothing casts a shadow in dark`, shadows.length === 0, shadows.join(', '));
  }
}

/** `usdLabel` from `lib/usage-view.ts`, copied rather than imported: this script runs outside `@robot/app`. */
function usdLabel(n: number): string {
  if (n > 0 && n < 0.005) return '< $0.01';
  return `$${n.toFixed(2)}`;
}

/** `monthKey` from `lib/usage-view.ts`: the UTC month the Usage screen opens on. */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `deleteNote` from `lib/org-settings-view.ts`: why Delete organisation is off, or `null` if it is live. */
function deleteNote(role: string, personal: boolean): string | null {
  if (personal) return 'Your personal organisation cannot be deleted';
  if (role !== 'owner') return 'Only the owner can delete the organisation';
  return null;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

await signIn();

// Switching the theme writes to this account's user row, and given a real
// address that is somebody's actual preference. It is read here and put back
// in the `finally` at the bottom: the check must leave the account as it
// found it.
const originalPreference = await storedPreference();
console.log(`stored theme preference on arrival: ${originalPreference}`);
console.log(`account: ${EMAIL}`);

try {

// This account's own state, from the same procedures every screen reads,
// taken once before the walk. The screens are then compared against *this*
// rather than against themselves: a Settings row that agrees with the API is
// a Settings row that is right, and one that agrees only with itself proves
// nothing.
const me = await query<{
  user: { id: string; email: string; name: string; theme: Preference };
  currentOrg: { id: string; name: string; role: string; personal: boolean };
}>('auth.me', undefined);
const members = await query<Array<{ userId: string; email: string; name: string; role: string }>>('orgs.members.list', undefined);
const orgRuns = await query<Array<{ id: string; project: { slug: string }; website: { slug: string } }>>('runs.listByOrg', undefined);
const month = monthKey(new Date());
const usage = await query<{ total: { spendUsd: number }; projects: Array<{ id: string; name: string }> }>('usage.byProject', { month });

console.log(
  `auth.me: ${me.user.email}, organisation "${me.currentOrg.name}" (${me.currentOrg.role}${me.currentOrg.personal ? ', personal' : ''})`,
);
console.log(`orgs.members.list: ${members.length} member(s)`);
console.log(`runs.listByOrg: ${orgRuns.length} run(s)`);
console.log(`usage.byProject(${month}): ${usage.projects.length} project(s), $${usage.total.spendUsd.toFixed(4)} total`);

for (const theme of ['dark', 'light'] as const) {
  console.log(`\n── ${theme} ──`);
  check(`theme switches to ${theme} and the server renders it`, await setTheme(theme));

  // ── Runs ──────────────────────────────────────────────────────────────────
  errors = [];
  const runsPage = await p.goto(`${APP}/runs`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  check('runs renders', !!runsPage?.ok() && (await p.locator('h1').count()) > 0, `HTTP ${runsPage?.status()}`);

  const runRows = await p.locator('tbody tr').count();
  if (orgRuns.length > 0) {
    check('the table has at least one row', runRows >= 1, `${runRows} rows`);
    const links = await p.locator('tbody a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''));
    const started = links.filter((href) => /^\/projects\/[^/]+\/sites\/[^/]+\/runs\/[^/]+$/.test(href));
    check(
      "every row's Started cell links to /projects/…/sites/…/runs/…",
      started.length >= runRows,
      `${started.length} of ${runRows} rows had such a link`,
    );
  } else {
    // Nothing in this organisation has ever run, and running costs money — so
    // the empty state is this screen's true state here, and the populated
    // table cannot be photographed without spending. Said out loud rather
    // than passed off as a test.
    check('runs shows its empty state', (await p.locator('main').innerText()).includes('No runs yet'), '');
    measure('runs', 'SKIP — no run in this organisation, so there is no table row to measure');
  }

  await shellMeasurements('runs', theme);
  check('runs logs nothing', errors.length === 0, errors.join(' | '));
  await shoot(SCREENS, `app-org-runs-${theme}.png`);

  // ── Usage ─────────────────────────────────────────────────────────────────
  errors = [];
  const usagePage = await p.goto(`${APP}/usage`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  check('usage renders', !!usagePage?.ok() && (await p.locator('h1').count()) > 0, `HTTP ${usagePage?.status()}`);

  const total = norm(await p.getByTestId('usage-total').innerText());
  check(`the Usage total reads ${usdLabel(usage.total.spendUsd)}`, total === usdLabel(usage.total.spendUsd), total);

  const usageRows = await p.locator('tbody tr').count();
  check(
    `the table has one row per project (${usage.projects.length})`,
    usageRows === usage.projects.length,
    `${usageRows} rows vs ${usage.projects.length} from the API`,
  );

  await shellMeasurements('usage', theme);
  check('usage logs nothing', errors.length === 0, errors.join(' | '));
  await shoot(SCREENS, `app-org-usage-${theme}.png`);

  // ── Settings ──────────────────────────────────────────────────────────────
  errors = [];
  const settingsPage = await p.goto(`${APP}/settings`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  check('settings renders', !!settingsPage?.ok() && (await p.locator('h1').count()) > 0, `HTTP ${settingsPage?.status()}`);

  const orgName = await p.getByLabel('Name', { exact: true }).inputValue();
  check(`the organisation name field reads "${me.currentOrg.name}"`, orgName === me.currentOrg.name, orgName);

  const membersRows = await p.locator('tbody tr').count();
  check(`the members table has ${members.length} row(s)`, membersRows === members.length, `${membersRows}`);
  const meRow = norm(await p.locator('tbody').innerText());
  check(`the signed-in address (${me.user.email}) is marked "you"`, meRow.includes(me.user.email) && meRow.includes('you'), meRow.slice(0, 200));

  // Read, never pressed — Delete organisation is one of the controls this
  // check must not touch.
  const del = p.getByRole('button', { name: 'Delete organisation' });
  const delDisabled = await del.isDisabled();
  const expectedNote = deleteNote(me.currentOrg.role, me.currentOrg.personal);
  check(
    `Delete organisation is ${expectedNote ? 'disabled' : 'live'}, as this account's role says`,
    delDisabled === (expectedNote !== null),
    `disabled=${delDisabled}, role=${me.currentOrg.role}, personal=${me.currentOrg.personal}`,
  );
  const reasonText = norm(await p.locator('main').innerText());
  if (expectedNote) check(`its reason reads "${expectedNote}"`, reasonText.includes(expectedNote), '');
  measure('delete reason on screen', expectedNote ?? '(none — the control is live)');

  await shellMeasurements('settings', theme);
  check('settings logs nothing', errors.length === 0, errors.join(' | '));
  await shoot(SCREENS, `app-org-settings-${theme}.png`);

  // ── Account ───────────────────────────────────────────────────────────────
  errors = [];
  const accountPage = await p.goto(`${APP}/account`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  check('account renders', !!accountPage?.ok() && (await p.locator('h1').count()) > 0, `HTTP ${accountPage?.status()}`);

  const accountBody = norm(await p.locator('main').innerText());
  check(`the signed-in email (${me.user.email}) is shown`, accountBody.includes(me.user.email), '');

  const nowPreference = await storedPreference();
  const checkedRadio = await p.getByRole('radio', { checked: true }).getAttribute('id');
  check(
    `the checked theme radio equals auth.me's theme ("${nowPreference}")`,
    checkedRadio === `theme-${nowPreference}`,
    `checked=${checkedRadio}`,
  );

  await shellMeasurements('account', theme);
  check('account logs nothing', errors.length === 0, errors.join(' | '));
  await shoot(SCREENS, `app-org-account-${theme}.png`);
}

} finally {
  // ── What this check actually asked the server for ─────────────────────────
  // In the `finally`, not above it: this is the check's own safety assertion,
  // and an assertion whose job is to prove nothing was written is worth the
  // most on the run that threw half way through. Skipping it there would
  // leave the one path where something unexpected happened with no evidence
  // at all.
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
