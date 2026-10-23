// The stack in a real browser (spec 2026-10-23 docker-compose §6), from the repo root after docker/smoke/e2e.mjs:
//   node docker/smoke/ui.mjs <screenshot dir>
// A real browser against the stack's app (:3200): sign in through /login, land signed in, reload (the SSR
// session lookup over API_INTERNAL_URL must keep us signed in), open the project the e2e made.
import { createRequire } from 'node:module';
// Playwright from @robot/browser's own install (the repo root has none).
const require = createRequire(new URL('../../packages/browser/package.json', import.meta.url));
const { chromium } = require('playwright');
const APP = 'http://127.0.0.1:3200';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const fails = [];
page.on('console', (m) => { if (m.type() === 'error') fails.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => fails.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
await page.goto(`${APP}/login`);
await page.fill('input[name=email]', 'stack-smoke@example.com');
await page.fill('input[name=password]', 'x');
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
await page.waitForLoadState('networkidle');
console.log('after sign-in:', new URL(page.url()).pathname);
await page.screenshot({ path: `${out}/app-after-signin.png` });
const ssr = await (await page.request.get(`${APP}/`)).text();
const r = await page.request.get(`${APP}/`, { maxRedirects: 0 });
console.log('GET / with the session cookie:', r.status(), 'location', r.headers()['location'] ?? '-');
await page.reload();
await page.waitForLoadState('networkidle');
console.log('after reload:', new URL(page.url()).pathname);
const text = await page.locator('body').innerText();
console.log('page shows the e2e project:', /Stack smoke/.test(text));
await page.screenshot({ path: `${out}/app-after-reload.png` });
console.log('browser errors:', fails.length ? fails : 'none');
await browser.close();
