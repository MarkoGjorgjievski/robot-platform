// Overlay research: mode A = real capture() + probe; mode B = instrumented copy of the capture steps;
// mode C = attribution (after dismissal, click each expand candidate alone, see what overlay appears).
// Run from packages/browser:  npx tsx <this> <A|B|C> [site,...]
import { PlaywrightBrowser } from 'file:///C:/Users/Marko/Documents/projects/robot-platform/packages/browser/src/playwright-browser.ts';
import { writeFileSync } from 'node:fs';

const OUT = 'C:/Users/Marko/AppData/Local/Temp/claude/C--Users-Marko-Documents-projects-robot-platform/a75cfd11-80b1-4ff8-b301-282f0da03222/scratchpad/overlays/';
const mode = process.argv[2] ?? 'A';
const only = process.argv[3]?.split(',');

const SITES: Array<[string, string[]]> = [
  ['colourpop', ['https://colourpop.com/products/aurora-stuck-shadow-palette', 'https://colourpop.com/products/fade-to-hue-pressed-powder-makeup-palette']],
  ['mejuri', ['https://mejuri.com/my/en/products/stacker-ring?Material=10k+Yellow+Gold', 'https://mejuri.com/my/en/products/diamonds-band?Material=14k+Yellow+Gold&Stone=Natural+Diamond']],
  ['kith', ['https://kith.com/collections/kith-women-sweatshirts/products/khwa030083-338', 'https://kith.com/collections/kith-women-sweatshirts/products/khwa030103-2017']],
  ['skullcandy', ['https://www.skullcandy.com/products/crusher-evo-sensory-bass-headphones-with-personal-sound', 'https://www.skullcandy.com/products/grom-wireless-headphones-for-kids']],
  ['lacoste', ['https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=001', 'https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-00.html?color=031']],
  ['pumade', ['https://eu.puma.com/de/de/pd/suede-classic-sneakers-unisex/399781?swatch=07', 'https://eu.puma.com/de/de/pd/palermo-sneakers-unisex/396463?swatch=98']],
  ['thomann', ['https://www.thomann.de/de/taylor_814ce_n.htm?type=category', 'https://www.thomann.de/de/taylor_112ce_n.htm?type=category', 'https://www.thomann.de/de/taylor_314ce_n.htm?type=category']],
  ['ikea', ['https://www.ikea.com/my/en/p/glostad-2-seat-sofa-knisa-dark-grey-10489009/', 'https://www.ikea.com/my/en/p/kivik-2-seat-sofa-tibbleby-beige-grey-s19440594/']],
];

// ---- probe: what covers the page right now -------------------------------------------------
const PROBE = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const txt = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  const desc = (el) => { if (!el || !el.tagName) return null; const c = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (c ? '.' + c.trim().split(/\\s+/).slice(0, 3).join('.') : '') + (el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : ''); };
  const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw; };
  const fixedAnc = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed') return e; } return null; };
  const pts = { centre: [640, 400], buyTop: [960, 250], buyMid: [960, 450], left: [320, 400] };
  const points = {};
  for (const [k, [x, y]] of Object.entries(pts)) { const top = document.elementFromPoint(x, y); const fa = top && fixedAnc(top); points[k] = { top: desc(top), fixed: fa ? desc(fa) + ' «' + txt(fa).slice(0, 60) + '»' : null }; }
  const dialogs = [...document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open]')].filter(vis).map((d) => ({ el: desc(d), modal: d.getAttribute('aria-modal'), label: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby'), text: txt(d) }));
  const fixed = [];
  for (const el of document.querySelectorAll('body *')) { const s = getComputedStyle(el); if (s.position !== 'fixed') continue; const z = parseInt(s.zIndex) || 0; if (!vis(el)) continue; const r = el.getBoundingClientRect(); const area = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0)) / (vw * vh);
    if (area < 0.04) continue; fixed.push({ el: desc(el), z, area: Math.round(area * 100), rect: [r.left, r.top, r.width, r.height].map(Math.round), text: txt(el) }); }
  const iframes = [...document.querySelectorAll('iframe')].filter(vis).map((f) => ({ src: (f.src || '').slice(0, 90), rect: (() => { const r = f.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); })() })).filter((f) => f.rect[2] * f.rect[3] > 20000);
  const h1 = document.querySelector('h1');
  return { url: location.href, scrollY: Math.round(scrollY), width: document.documentElement.scrollWidth, h1: h1 ? { text: txt(h1), x: Math.round(h1.getBoundingClientRect().x) } : null, bodyOverflow: getComputedStyle(document.body).overflow, points, dialogs, fixed: fixed.slice(0, 12), iframes };
})()`;

// ---- instrumented copies of the product's passes ---------------------------------------------
const POPUP_DISMISS_SELECTORS = [
  'button[id*="cookie" i][id*="accept" i]', 'button[id*="cookie" i][id*="close" i]', 'button[id*="consent" i][id*="accept" i]',
  'button[class*="cookie" i][class*="accept" i]', 'button[class*="consent" i][class*="accept" i]', 'button[data-testid*="cookie" i]',
  '#onetrust-accept-btn-handler', '#accept-cookie-notification', '.cookie-banner button', '.cookie-notice button',
  '[aria-label*="cookie" i][aria-label*="accept" i]', '[aria-label*="cookie" i][aria-label*="close" i]',
  'button[id*="consent" i][id*="close" i]', 'button[class*="consent" i][class*="close" i]', '[data-testid="close-consent"]',
  'button[class*="privacy" i][class*="accept" i]', 'button[class*="consent" i][class*="continue" i]',
  'button:has-text("Continue shopping")', 'button:has-text("Accept all")', 'button:has-text("Accept cookies")', 'button:has-text("Accept All Cookies")',
  'button:has-text("I Accept")', 'button:has-text("I agree")', 'button:has-text("Got it")', 'button:has-text("OK")', 'button:has-text("Close")',
  '[aria-label="Close dialog"]', '[aria-label="Close modal"]', '[aria-label="Close"]', 'button[class*="modal" i][class*="close" i]',
  '.modal-close', '.popup-close', '[data-dismiss="modal"]', 'dialog button[aria-label*="close" i]', '[role="dialog"] button[aria-label*="close" i]',
];
const DESCRIBE_EL = `(el) => { const c = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
  const a = {}; for (const n of el.getAttributeNames()) if (/^(aria-|data-|href|id|type|role)/.test(n)) a[n] = (el.getAttribute(n) || '').slice(0, 60);
  const ctl = el.getAttribute('aria-controls'); const t = ctl ? document.getElementById(ctl.split(' ')[0]) : null;
  const tgt = t ? { tag: t.tagName.toLowerCase(), role: t.getAttribute('role'), modal: t.getAttribute('aria-modal'), pos: getComputedStyle(t).position, cls: (typeof t.className === 'string' ? t.className : '').slice(0, 60) } : null;
  const dlg = el.closest('[role=dialog],dialog,[aria-modal=true]');
  return { tag: el.tagName.toLowerCase(), cls: c.slice(0, 70), attrs: a, text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60), target: tgt, inDialog: dlg ? dlg.tagName.toLowerCase() + (dlg.id ? '#' + dlg.id : '') : null }; }`;

async function dismissInstrumented(page: any, log: any[]) {
  await page.waitForTimeout(1500);
  for (let round = 0; round < 3; round++) {
    let dismissed = false;
    for (const selector of POPUP_DISMISS_SELECTORS) {
      try {
        const el = page.locator(selector).first();
        if (!(await el.isVisible({ timeout: 200 }))) continue;
        const info = await el.evaluate(new Function('return ' + DESCRIBE_EL)());
        const href = await el.evaluate((n: Element) => { const a = n.closest('a'); return a ? a.getAttribute('href') : null; });
        if (href && !/^#|^javascript:/i.test(href)) { log.push({ pass: 'dismiss', round, selector, skipped: 'navigates', info }); continue; }
        await el.click({ timeout: 2000, force: true });
        log.push({ pass: 'dismiss', round, selector, info });
        await page.waitForTimeout(800);
        dismissed = true; break;
      } catch { /* next */ }
    }
    if (!dismissed) {
      const removed = await page.evaluate(() => {
        const out: string[] = [];
        const d = (el: Element) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String((el as HTMLElement).className || '').slice(0, 50) + ' «' + ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) + '»';
        for (const sel of ['[class*="overlay" i][class*="modal" i]', '[class*="overlay" i][class*="consent" i]', '[class*="modal" i][class*="backdrop" i]', '[id*="consent" i][role="dialog"]', '[role="dialog"][aria-modal="true"]'])
          document.querySelectorAll(sel).forEach((el) => { out.push(sel + ' -> ' + d(el)); el.remove(); });
        document.querySelectorAll('body > div').forEach((el) => { const s = getComputedStyle(el); if ((s.position === 'fixed' || s.position === 'absolute') && parseFloat(s.zIndex) > 1000 && el.querySelector('button')) { out.push('body>div fixed z>1000 -> ' + d(el)); el.remove(); } });
        if (document.body) document.body.style.overflow = ''; if (document.documentElement) document.documentElement.style.overflow = '';
        return out;
      });
      if (removed.length) { log.push({ pass: 'dismiss-js', round, removed }); await page.waitForTimeout(500); } else break;
    }
  }
}

const EXPAND_SELECTORS = ['main details:not([open]) summary', 'article details:not([open]) summary', 'main [aria-expanded="false"]', 'article [aria-expanded="false"]', 'main [data-toggle="collapse"]', 'article [data-toggle="collapse"]'];
const EXPAND_TEXT = '^(show more|see more|see all|view details|read more|expand|view all|load more|\\+ more|show all)$';

async function expandInstrumented(page: any, log: any[], shot: (n: string) => Promise<void>) {
  const describe = DESCRIBE_EL;
  for (let round = 0; round < 2; round++) {
    let expanded = false;
    const p1 = await page.evaluate(([selectors, describe]: [string[], string]) => {
      const D = new Function('return ' + describe)();
      const out: any[] = [];
      for (const selector of selectors) {
        const els = Array.prototype.slice.call(document.querySelectorAll(selector), 0, 10);
        for (const el of els) { if (el.offsetParent === null) continue; const info = D(el); try { el.click(); out.push({ selector, ...info }); } catch { /* */ } }
      }
      return out;
    }, [EXPAND_SELECTORS, describe]);
    for (const c of p1) log.push({ pass: 'expand-p1', round, ...c });
    if (p1.length) expanded = true;
    const p2 = await page.evaluate(([pattern, describe]: [string, string]) => {
      const D = new Function('return ' + describe)();
      const out: any[] = []; const re = new RegExp(pattern, 'i');
      const main = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
      main.querySelectorAll('button, a[role="button"], [class*="expand"], [class*="show-more"], [class*="read-more"]').forEach((el: any) => {
        const text = el.textContent?.trim() ?? ''; if (re.test(text) && el.offsetParent !== null) { out.push({ selector: 'text', ...D(el) }); el.click(); } });
      main.querySelectorAll('details:not([open])').forEach((el: any) => { out.push({ selector: 'details-open-attr', ...D(el) }); el.setAttribute('open', ''); });
      return out;
    }, [EXPAND_TEXT, describe]);
    for (const c of p2) log.push({ pass: 'expand-p2', round, ...c });
    if (p2.length) expanded = true;
    if (expanded) { await page.waitForTimeout(500); await shot(`r${round}`); } else break;
  }
  const p3 = await page.evaluate((describe: string) => {
    const D = new Function('return ' + describe)();
    const main = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
    const clicked: any[] = []; const seen = new Set();
    const clickTab = (el: any) => { if (seen.has(el) || !el.offsetParent) return; seen.add(el); clicked.push(el); };
    main.querySelectorAll('[role="tab"]').forEach(clickTab);
    main.querySelectorAll('[data-tab]').forEach(clickTab);
    main.querySelectorAll('[class*="tab" i]').forEach((el: any) => { const classes = String(el.className).toLowerCase();
      if ((classes.includes('tab__') || classes.includes('tab-') || classes.includes('tabs__')) && !classes.includes('panel') && !classes.includes('content') && !classes.includes('body')) { if (el.matches('button, a, [role="tab"]')) clickTab(el); } });
    const infos = clicked.map((el) => D(el));
    clicked.forEach((el, i) => setTimeout(() => el.click(), i * 300));
    return infos;
  }, describe);
  for (const c of p3) log.push({ pass: 'expand-p3-tabs', ...c });
  if (p3.length) await page.waitForTimeout(Math.min(p3.length * 300 + 500, 3000));
}

// ---- C: attribution — after dismissal, click each phase-1/2 candidate alone and see what appears ----
const OVERLAY_SIG = `(() => { const vw = innerWidth, vh = innerHeight; const out = [];
  for (const el of document.querySelectorAll('body *')) { const s = getComputedStyle(el); if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) continue; const r = el.getBoundingClientRect();
    const area = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0)) / (vw * vh); if (area < 0.08) continue;
    out.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className || '').slice(0, 40) + ' ' + Math.round(area * 100) + '% «' + (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 50) + '»'); }
  for (const d of document.querySelectorAll('[role=dialog],dialog[open],[aria-modal=true]')) { const r = d.getBoundingClientRect(); const s = getComputedStyle(d); if (r.width > 50 && r.height > 50 && s.visibility !== 'hidden' && s.display !== 'none') out.push('DIALOG ' + d.tagName.toLowerCase() + (d.id ? '#' + d.id : '') + ' «' + (d.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 50) + '»'); }
  return out; })()`;

const CLOSERS = `(() => { const vw = innerWidth, vh = innerHeight; const out = [];
  const cands = [...document.querySelectorAll('body *')].filter((el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); if (r.width < 50 || r.height < 50 || r.bottom < 0 || r.top > vh) return false; return el.matches('[role=dialog],dialog[open],[aria-modal=true]') || (s.position === 'fixed' && r.width * r.height > 0.04 * vw * vh); });
  for (const c of cands.slice(0, 8)) { const btns = [...c.querySelectorAll('button,a,[role=button]')].filter((b) => b.getBoundingClientRect().width > 0).slice(0, 8).map((b) => b.tagName.toLowerCase() + (b.id ? '#' + b.id : '') + ' cls=' + String(b.className || '').slice(0, 40) + ' aria-label=' + b.getAttribute('aria-label') + ' text=' + (b.innerText || '').trim().slice(0, 30) + (b.getAttribute('href') ? ' href=' + b.getAttribute('href').slice(0, 40) : ''));
    out.push({ el: c.tagName.toLowerCase() + (c.id ? '#' + c.id : '') + '.' + String(c.className || '').slice(0, 50) + ' role=' + c.getAttribute('role') + ' modal=' + c.getAttribute('aria-modal') + ' z=' + getComputedStyle(c).zIndex, text: (c.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 90), btns }); }
  return out; })()`;
async function attribute(page: any, log: any[]) {
  log.push({ pass: 'closers-after-dismiss', closers: await page.evaluate(CLOSERS) });
  const n = await page.evaluate(([sels, pat]: [string[], string]) => {
    const re = new RegExp(pat, 'i'); const all: Element[] = [];
    for (const s of sels) for (const el of Array.prototype.slice.call(document.querySelectorAll(s), 0, 10)) if ((el as HTMLElement).offsetParent !== null && !all.includes(el)) all.push(el);
    const main = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
    main.querySelectorAll('button, a[role="button"], [class*="expand"], [class*="show-more"], [class*="read-more"]').forEach((el) => { if (re.test(el.textContent?.trim() ?? '') && (el as HTMLElement).offsetParent !== null && !all.includes(el)) all.push(el); });
    all.forEach((el, i) => el.setAttribute('data-ovl-i', String(i)));
    return all.length;
  }, [EXPAND_SELECTORS, EXPAND_TEXT]);
  let before: string[] = await page.evaluate(OVERLAY_SIG);
  log.push({ pass: 'attr-baseline', overlays: before, candidates: n });
  for (let i = 0; i < n; i++) {
    const info = await page.evaluate(([i, describe]: [number, string]) => { const el = document.querySelector(`[data-ovl-i="${i}"]`) as HTMLElement | null; if (!el) return null; const D = new Function('return ' + describe)(); const inf = D(el); el.click(); return inf; }, [i, DESCRIBE_EL]);
    if (!info) continue;
    await page.waitForTimeout(700);
    const after: string[] = await page.evaluate(OVERLAY_SIG);
    const added = after.filter((x) => !before.includes(x));
    log.push({ pass: 'attr', i, ...info, newOverlays: added });
    before = after;
  }
}

async function shotTile(page: any, file: string) {
  await page.screenshot({ path: file, type: 'png', fullPage: true, clip: { x: 0, y: 0, width: 1280, height: 1536 }, timeout: 30000 }).catch((e: Error) => console.log('shot failed', e.message.split('\n')[0]));
}

async function resolveListing(b: any, listing: string): Promise<string[]> {
  const page = await b.context.newPage();
  try {
    await page.goto(listing, { waitUntil: 'load', timeout: 45000 }); await page.waitForTimeout(3000);
    const links: string[] = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/pd/"]')].map((a) => (a as HTMLAnchorElement).href))]);
    console.log('listing', page.url(), links.length, links.slice(0, 2).join(' ')); return links.slice(0, 2);
  } finally { await page.close(); }
}

for (const [site, urls0] of SITES) {
  if (only && !only.includes(site)) continue;
  const b = new PlaywrightBrowser();
  await b.launch({ headless: true });
  if (mode !== 'A') await (b as any).context.addInitScript('window.__name = (f) => f;');
  let urls = urls0;
  try {
    if (urls0[0].startsWith('LISTING:')) urls = await resolveListing(b as any, urls0[0].slice(8));
    for (let k = 0; k < urls.length; k++) {
      const url = urls[k]; const tag = `${site}-${k + 1}`;
      try {
        if (mode === 'A') {
          const c = await b.capture(url, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, timeout: 45000, annotate: PROBE });
          writeFileSync(OUT + `${tag}-A.png`, c.screenshotTiles[0] ?? c.screenshot);
          writeFileSync(OUT + `${tag}-A.json`, JSON.stringify({ url, verdict: c.verdict, probe: c.annotation }, null, 1));
          const p = c.annotation as any;
          console.log(`A ${tag} ${c.verdict.kind} w=${p?.width} dialogs=${p?.dialogs?.length} fixed=${(p?.fixed ?? []).map((f: any) => f.el + ' ' + f.area + '%').join(' | ')} iframes=${p?.iframes?.length}`);
        } else {
          const page = await (b as any).context.newPage();
          const log: any[] = [];
          await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch((e: Error) => { log.push({ gotoTimeout: e.message.slice(0, 100) }); });
          const probes: any = { load: await page.evaluate(PROBE) };
          await shotTile(page, OUT + `${tag}-${mode}0-load.png`);
          await dismissInstrumented(page, log);
          probes.afterDismiss = await page.evaluate(PROBE);
          await shotTile(page, OUT + `${tag}-${mode}1-dismiss.png`);
          if (mode === 'B') {
            await expandInstrumented(page, log, async (n) => { probes['expand-' + n] = await page.evaluate(PROBE); await shotTile(page, OUT + `${tag}-B2-expand-${n}.png`); });
            probes.final = await page.evaluate(PROBE);
            await shotTile(page, OUT + `${tag}-B3-final.png`);
          } else {
            await attribute(page, log);
            probes.final = await page.evaluate(PROBE);
          }
          writeFileSync(OUT + `${tag}-${mode}.json`, JSON.stringify({ url, probes, log }, null, 1));
          console.log(`${mode} ${tag} log=${log.length} final dialogs=${probes.final.dialogs.length} fixed=${probes.final.fixed.map((f: any) => f.el + ' ' + f.area + '%').join(' | ')}`);
          await page.close();
        }
      } catch (e) { console.log(`${mode} ${tag} threw ${(e as Error).message.split('\n')[0].slice(0, 120)}`); }
    }
  } finally { await b.close(); }
}
