// Look-only browser check of the new app's shell (`@robot/app`, :3000), in both themes.
// It signs in through the login form, walks every screen of plan 1, prints the
// measurements spec §3/§4 can be held to, and leaves a screenshot of each state.
// It creates nothing and deletes nothing: the only write it makes is the user's
// own theme preference, which is what "switch the theme" means.
//
// Run from packages/browser so `playwright` resolves:
//   cp docs/testing/ui-check-app-shell.mts packages/browser/src/__ui-check.mts \
//     && cd packages/browser && pnpm exec tsx src/__ui-check.mts <outDir> [email] ; rm src/__ui-check.mts
//
// With no email it signs in as a throwaway `smoke-<timestamp>@example.com` (a new
// user, so an empty organisation — the empty state is what gets measured). Give it
// a real address to measure the same screens with that account's data.
//
// Needs the api-server (:4000) and the app (:3000) already running. Do not start
// or stop the user's dev servers.
import { chromium, type Page } from 'playwright';

const out = process.argv[2] ?? '.';
const EMAIL = process.argv[3] ?? `smoke-${Date.now()}@example.com`;
const APP = 'http://localhost:3000';
const ROUTES = ['/projects', '/runs', '/usage', '/settings', '/account'] as const;

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
const shoot = (file: string, fullPage = false) =>
  p.screenshot({ path: `${out}/${file}`, fullPage, animations: 'disabled' });

/** React tags hydrated host nodes with `__reactProps$…`; typing before that is typing into nothing. */
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
  await shoot('check-login.png', true);
  await hydrated('#email');
  await p.locator('#email').fill(EMAIL);
  await p.locator('#password').fill('check');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL(`${APP}/projects`, { timeout: 30_000 });
}

/** User menu → Theme → the radio item, then wait for the server to agree (a reload proves it). */
async function setTheme(theme: 'dark' | 'light') {
  await p.locator('aside button').filter({ hasText: EMAIL }).first().click();
  await p.getByRole('menuitem', { name: 'Theme' }).click();
  const saved = p.waitForResponse((r) => r.url().includes('auth.setTheme'), { timeout: 15_000 }).catch(() => null);
  await p.getByRole('menuitemradio', { name: theme === 'dark' ? 'Dark' : 'Light' }).click();
  await saved;
  await p.keyboard.press('Escape');
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

await signIn();

// ── The walk, once per theme ────────────────────────────────────────────────
for (const theme of ['dark', 'light'] as const) {
  console.log(`\n── ${theme} ──`);
  check(`theme switches to ${theme} and the server renders it`, await setTheme(theme));

  for (const route of ROUTES) {
    errors = [];
    const res = await p.goto(APP + route, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    const body = (await p.locator('body').innerText()).trim();
    check(`${route} renders`, !!res?.ok() && body.length > 20 && (await p.locator('h1').count()) > 0, `HTTP ${res?.status()}`);
    check(`${route} keeps the sidebar`, (await p.locator('aside nav a').count()) === 4);
    check(`${route} logs nothing`, errors.length === 0, errors.join(' | '));
    await shoot(`check-${route.slice(1)}-${theme}.png`, true);
  }

  // The floating surfaces, which only exist while something is open.
  await p.goto(`${APP}/projects`, { waitUntil: 'networkidle' });
  await hydrated('aside');
  await p.locator('aside button').first().click();
  await shoot(`check-switcher-${theme}.png`);
  await p.keyboard.press('Escape');
  await p.locator('aside button').filter({ hasText: EMAIL }).first().click();
  await shoot(`check-user-menu-${theme}.png`);
  // The theme submenu open over it: three labels that have to line up with the
  // two items above them, and a radio column that has to line up with itself.
  await p.getByRole('menuitem', { name: 'Theme' }).click();
  await p.waitForTimeout(250);
  await shoot(`check-theme-menu-${theme}.png`);
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Control+k');
  await p.waitForTimeout(500);
  await shoot(`check-command-${theme}.png`);
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'New project' }).first().click();
  await p.waitForTimeout(400);
  await shoot(`check-dialog-${theme}.png`);
  if (theme === 'dark') {
    // The shadow rule is really about floating surfaces, and a page with nothing
    // open has none — so it is asked here, with the dialog, its overlay and a
    // form field on screen.
    const overlaid = await shadowedElements(p);
    check('nothing casts a shadow in dark, dialog open', overlaid.length === 0, overlaid.join(', '));
  }
  await p.keyboard.press('Escape');

  // A focus ring on a real control, with nothing open over it.
  await p.locator('aside nav a').nth(2).focus();
  await p.waitForTimeout(200);
  await shoot(`check-focus-${theme}.png`);

  // The measurements below are rules about the dark theme, so they are taken once.
  if (theme !== 'dark') continue;

  // ── Measurements (spec §3, §4) ────────────────────────────────────────────
  console.log('\n── measurements (dark, /projects) ──');
  await p.goto(`${APP}/projects`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);

  const sidebar = await p.locator('aside').evaluate((el) => el.getBoundingClientRect().width);
  check('sidebar is 240 px', sidebar === 240, `${sidebar}`);
  measure('sidebar width', `${sidebar}px`);

  const bodyFont = await p.evaluate(() => getComputedStyle(document.body).fontSize);
  check('body font-size is 13 px', bodyFont === '13px', bodyFont);
  measure('body font-size', bodyFont);

  const title = await p.locator('h1').evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: s.fontSize, weight: s.fontWeight };
  });
  check('page title is 20 px', title.size === '20px', `${title.size} / ${title.weight}`);
  measure('page title', `${title.size} ${title.weight}`);

  const rows = await p.locator('tbody tr').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  if (rows.length === 0) {
    console.log('      table row height: SKIP — this organisation has no project, so there is no table');
  } else {
    const tallest = Math.max(...rows);
    check('every table row is 40 px or shorter', tallest <= 40, `tallest ${tallest.toFixed(2)}px of ${rows.length} rows`);
    measure('table row height', `${tallest.toFixed(2)}px (max of ${rows.length})`);
  }

  const upper = await uppercaseElements(p);
  check('nothing is uppercased', upper.length === 0, upper.join(', '));
  measure('uppercase elements', `${upper.length}`);

  const shadows = await shadowedElements(p);
  check('nothing casts a shadow in dark', shadows.length === 0, shadows.join(', '));
  measure('shadowed elements in dark', `${shadows.length}`);

  // The running dot. There is no run in this database yet, so when no live dot
  // is on screen the rule itself is read instead — the class the component puts
  // on a running dot, resolved by the browser on a real element.
  const live = p.locator('[aria-label="Running"]').first();
  if (await live.count()) {
    const anim = await live.evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, duration: s.animationDuration, size: el.getBoundingClientRect().width };
    });
    check('the running dot pulses', anim.name === 'pulse-dot', `${anim.name} ${anim.duration}`);
    measure('running dot', `${anim.name} ${anim.duration} ${anim.size}px (live run)`);
  } else {
    const probe = await p.evaluate(() => {
      const el = document.createElement('span');
      el.className = 'inline-block size-[8px] rounded-full bg-text dot-running';
      document.body.appendChild(el);
      const s = getComputedStyle(el);
      const result = { name: s.animationName, duration: s.animationDuration, size: el.getBoundingClientRect().width };
      el.remove();
      return result;
    });
    check('the running dot pulses', probe.name === 'pulse-dot' && probe.duration === '1.6s', `${probe.name} ${probe.duration}`);
    measure('running dot', `${probe.name} ${probe.duration} ${probe.size}px (no run in this database — the class was resolved on a probe element)`);
  }
}

// ── Signed out ──────────────────────────────────────────────────────────────
// In a context of its own, signing in again first: `auth.signOut` ends the one
// session it is called with, and ending the session this check has been using
// would end a real person's too when it is run against a real account.
console.log('\n── signed out ──');
{
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.goto(`${APP}/login`, { waitUntil: 'networkidle' });
  await p2.waitForFunction(
    () => {
      const el = document.querySelector('#email');
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps$'));
    },
    undefined,
    { timeout: 20_000 },
  );
  await p2.locator('#email').fill(EMAIL);
  await p2.locator('#password').fill('check');
  await p2.getByRole('button', { name: 'Sign in' }).click();
  await p2.waitForURL(`${APP}/projects`, { timeout: 30_000 });
  await p2.locator('aside button').filter({ hasText: EMAIL }).first().click();
  await p2.getByRole('menuitem', { name: 'Sign out' }).click();
  await p2.waitForURL(`${APP}/login`, { timeout: 30_000 });
  await p2.goto(`${APP}/projects`, { waitUntil: 'networkidle' });
  check('a signed-out visitor is sent back to /login', new URL(p2.url()).pathname === '/login', p2.url());
  await ctx2.close();
}

await b.close();
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
