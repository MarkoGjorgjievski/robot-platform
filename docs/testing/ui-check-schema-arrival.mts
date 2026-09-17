// Look-only browser check of the Schema tab's arrival from a run. Never clicks Verify.
// Run from packages/browser so `playwright` resolves:
//   cp docs/testing/ui-check-schema-arrival.mts packages/browser/src/__ui-check.mts && cd packages/browser && pnpm exec tsx src/__ui-check.mts <outDir> ; rm src/__ui-check.mts
// Needs the user's dev servers already running (dashboard :3456, api :4000). Do not start or stop them.
import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const base = 'http://localhost:3456/projects/acne/sources/ikea';
const page4 = 'https://www.ikea.com/my/en/p/saltmyran-2-seat-sofa-oereryd-grey-beige-40618528/';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1700, height: 1000 } });
const p = await ctx.newPage();
const errors: string[] = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failed++; };

// 1. Plain Schema tab: three pages, eight fields, an Add page control the customer can SEE without scrolling the table.
await p.goto(base, { waitUntil: 'networkidle' });
let body = await p.locator('body').innerText();
check('plain: 8 of 8 fields verified', body.includes('8 of 8 fields verified'));
const add = p.getByRole('button', { name: /add (a )?(proof )?page/i }).first();
check('plain: an Add page control exists', (await add.count()) > 0);
if (await add.count()) check('plain: Add page control is inside the viewport without scrolling', await add.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight; }));
await p.screenshot({ path: `${out}/ui-1-schema-three-pages.png`, fullPage: true });

// 2. Cold arrival (fresh page load straight onto the link, the way a bookmark or a new tab arrives).
await p.goto(`${base}?addPage=${encodeURIComponent(page4)}&field=price`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
body = await p.locator('body').innerText();
check('cold arrival: the eight fields are still there', ['price', 'price_currency', 'title', 'subtitle', 'product_id', 'product_details', 'total_reviews', 'average_rating'].every((k) => body.includes(k)));
check('cold arrival: the three saved pages are still there', body.includes('glos') && body.includes('kivi') && body.includes('heml'));
check('cold arrival: page four was added', body.includes('Page 4'));
check('cold arrival: note names the field', /Added from a run: type what price should be on this page, then verify\./.test(body));
check('cold arrival: seven other cells on page four read "not checked"', (body.match(/not checked/g) ?? []).length >= 7, `${(body.match(/not checked/g) ?? []).length} found`);
check('cold arrival: no bogus problems about missing URLs', !body.includes('Every proof page needs a URL') && !body.includes('URLs must be different pages'));
check('cold arrival: strip does not say "of 0 fields"', !/of 0 fields/.test(body));
const focused = await p.evaluate(() => { const a = document.activeElement as HTMLInputElement | null; return a && a.tagName === 'INPUT' ? 'INPUT' : a?.tagName ?? 'none'; });
check('cold arrival: an input is focused (the price cell on page four)', focused === 'INPUT', focused);
await p.screenshot({ path: `${out}/ui-2-schema-arrival-cold.png`, fullPage: true });

// 3. Warm arrival (client-side navigation from the run page, the way "Use as proof page" arrives) is covered by the same effect; a reload of the arrival URL must behave the same.
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
body = await p.locator('body').innerText();
check('reload of the arrival url: still eight fields and page four', body.includes('average_rating') && body.includes('Page 4') && !/of 0 fields/.test(body));

check('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
