// Throwaway research probe: finder (as shipped) vs a card-based rule, plus a bounded scroll.
// Free: no LLM, no DB. One Chromium, sites one after another.
import { writeFileSync } from 'node:fs';
import { PlaywrightBrowser } from 'file:///C:/Users/Marko/Documents/projects/robot-platform/packages/browser/src/index.ts';
import { largestProductGroup, productPathTemplate, LISTING_ANCHORS_SCRIPT } from 'file:///C:/Users/Marko/Documents/projects/robot-platform/packages/scraper/src/crawl/product-link-group.ts';

const OUT = 'C:/Users/Marko/AppData/Local/Temp/claude/C--Users-Marko-Documents-projects-robot-platform/a75cfd11-80b1-4ff8-b301-282f0da03222/scratchpad/finder/out';

const ALL: Record<string, string> = {
  bombas: 'https://bombas.com/collections/mens-socks',
  burrow: 'https://burrow.com/collections/sofas',
  'thomann-cat': 'https://www.thomann.de/de/gitarren_baesse.html',
  thomann: 'https://www.thomann.de/de/4-4_konzertgitarren.html',
  'lacoste-polos': 'https://www.lacoste.com/gb/lacoste/men/clothing/polos/',
  lacoste: 'https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/',
  ikea: 'https://www.ikea.com/my/en/cat/sofas-fu003/',
  noths: 'https://www.notonthehighstreet.com/sale/jewellery-sale',
  ruggable: 'https://ruggable.com/collections/shop-all',
  skullcandy: 'https://www.skullcandy.com/collections/shop-all',
  puma: 'https://us.puma.com/us/en/men/shoes',
  gymshark: 'https://www.gymshark.com/collections/all-products/womens',
  ridge: 'https://ridge.com/collections/wallets',
};
const pick = process.argv.slice(2);
const SITES = Object.entries(ALL).filter(([k]) => pick.length === 0 || pick.includes(k));

// Card-based harvest, run in the live page. Each anchor -> its grid card (first ancestor that is one of >=3
// like siblings and holds an image or a price), the card's price/img, swatch hints, and whether it is navigation.
const CARD_SCRIPT = `(() => {
  const PRICE = /(?:[$\\u20ac\\u00a3\\u00a5]|RM|MYR|USD|EUR|GBP|AED|CHF)\\s?\\d|\\d[\\d.,]*\\s?(?:\\u20ac|\\u00a3|\\$|RM|AED|kr|CHF)/;
  const sig = (el) => el.tagName + '.' + ((el.getAttribute('class') || '').trim().split(/\\s+/)[0] || '');
  const repeated = (el) => {
    const p = el.parentElement; if (!p) return false;
    const s = sig(el); let n = 0;
    for (const c of p.children) if (sig(c) === s) n++;
    return n >= 3;
  };
  const chrome = (a) => {
    if (a.closest('nav, aside, [role~=navigation i], [role~=banner i], [role~=contentinfo i], [role~=complementary i]')) return true;
    const hf = a.closest('header, footer');
    return !!hf && !(hf.parentElement && hf.parentElement.closest('article, section, main, aside, nav'));
  };
  const cards = new Map(); let nextId = 0;
  const cardOf = (a) => {
    let el = a;
    for (let i = 0; el && el !== document.body && i < 10; i++, el = el.parentElement) {
      if (!repeated(el)) continue;
      const txt = (el.innerText || el.textContent || '');
      if (el.querySelector('img, picture, [style*=background-image]') || PRICE.test(txt)) {
        if (txt.length > 4000) return null;
        return el;
      }
    }
    return null;
  };
  const swatchy = (a) => !!a.closest('[role=radio], [role=radiogroup], [aria-checked], [class*=swatch i], [class*=colour i], [class*=color i], [data-swatch], [class*=variant i]')
    || /^\\+\\s?\\d+$/.test((a.textContent || '').trim());
  const out = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const c = cardOf(a);
    let id = null, price = false, img = false;
    if (c) {
      if (!cards.has(c)) cards.set(c, { id: nextId++, price: PRICE.test(c.innerText || ''), img: !!c.querySelector('img, picture') });
      const k = cards.get(c); id = k.id; price = k.price; img = k.img;
    }
    out.push({ href: a.getAttribute('href') || '', text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80), chrome: chrome(a), card: id, price, img, swatch: swatchy(a) });
  }
  const ld = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { const j = JSON.parse(s.textContent || ''); const walk = (x) => { if (Array.isArray(x)) return x.forEach(walk); if (x && typeof x === 'object') { if (x['@type']) ld.push(String(x['@type']) + (x.itemListElement ? ':' + x.itemListElement.length : '')); if (x['@graph']) walk(x['@graph']); } }; walk(j); } catch {}
  }
  return { anchors: out, ld, height: document.documentElement.scrollHeight };
})()`;

type A = { href: string; text: string; chrome: boolean; card: number | null; price: boolean; img: boolean; swatch: boolean };

function abs(h: string, base: string): URL | null { try { const u = new URL(h, base); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; } }

/** Proposed rule: product links are the main link of priced (or imaged) grid cards, grouped by URL shape, variants folded. */
function cardRule(anchors: A[], listingUrl: string) {
  const base = new URL(listingUrl);
  const byCard = new Map<number, { paths: Map<string, number>; price: boolean; img: boolean; swatchOnly: Set<string> }>();
  for (const a of anchors) {
    if (a.card === null || a.chrome) continue;
    const u = abs(a.href, listingUrl); if (!u || u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    if (u.pathname.replace(/\/+$/, '') === base.pathname.replace(/\/+$/, '')) continue;
    const key = u.origin + u.pathname.replace(/\/+$/, '');
    const c = byCard.get(a.card) ?? { paths: new Map(), price: a.price, img: a.img, swatchOnly: new Set() };
    if (a.swatch) c.swatchOnly.add(key); else c.paths.set(key, (c.paths.get(key) ?? 0) + 1);
    byCard.set(a.card, c);
  }
  // main link of a card: the non-swatch path seen most often in it
  const mains: Array<{ url: string; price: boolean; img: boolean }> = [];
  for (const c of byCard.values()) {
    const best = [...c.paths.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? [...c.swatchOnly][0];
    if (best) mains.push({ url: best, price: c.price, img: c.img });
  }
  // shape: path template on segment count + literal non-unique segments ... keep the shipped template for comparison
  const groups = new Map<string, typeof mains>();
  for (const m of mains) { const t = shape(new URL(m.url).pathname); (groups.get(t) ?? groups.set(t, []).get(t)!).push(m); }
  const scored = [...groups.entries()].map(([t, g]) => {
    const distinct = [...new Set(g.map((m) => m.url))];
    return { t, n: distinct.length, priced: g.filter((m) => m.price).length / g.length, urls: distinct };
  }).sort((x, y) => (y.priced >= 0.5 ? 1 : 0) - (x.priced >= 0.5 ? 1 : 0) || y.n - x.n);
  return scored;
}
/** Shape: segment count, with segments that look like ids/slugs (digits, hyphens, long) as '*'. */
function shape(p: string): string {
  return p.split('/').filter(Boolean).map((s) => (/\d/.test(s) || /-/.test(s) || s.length >= 12 ? '*' : s)).join('/') || '/';
}

function templates(anchors: A[], listingUrl: string) {
  const base = new URL(listingUrl);
  const g = new Map<string, Set<string>>();
  for (const a of anchors) {
    if (a.chrome) continue;
    const u = abs(a.href, listingUrl); if (!u || u.hostname !== base.hostname) continue;
    const t = productPathTemplate(u.pathname); const s = g.get(t) ?? new Set(); s.add(u.pathname + u.search); g.set(t, s);
  }
  return [...g.entries()].map(([t, s]) => ({ t, n: s.size, ex: [...s].slice(0, 2) })).sort((x, y) => y.n - x.n).slice(0, 6);
}

const b = new PlaywrightBrowser();
await b.launch();
const anyB = b as any;
for (const [site, url] of SITES) {
  const res: any = { site, url };
  const t0 = Date.now();
  try {
    // 1. The finder as shipped
    const cap = await b.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: false, timeout: 20_000 });
    res.finalUrl = cap.url; res.verdict = cap.verdict.kind;
    const anchors = await b.setContentEvaluate<any[]>(cap.html, LISTING_ANCHORS_SCRIPT);
    const group = largestProductGroup(anchors, url);
    const paths = group.map((u) => { const x = new URL(u); return x.pathname + x.search; });
    res.finder = { n: group.length, distinctPaths: new Set(group.map((u) => new URL(u).pathname)).size, first: paths.slice(0, 8), anchors: anchors.length };
    res.finderTemplates = templates(anchors as A[], url);

    // 2. Live page: card harvest before and after a bounded scroll
    const page = await anyB.context.newPage();
    try {
      await anyB.navigateWithFallback(page, url, { waitUntil: 'networkidle', timeout: 20_000 });
      await anyB.dismissPopups(page);
      const h0 = await page.evaluate(CARD_SCRIPT);
      const r0 = cardRule(h0.anchors, url);
      res.ld = h0.ld.slice(0, 12);
      res.before = { cards: r0[0]?.n ?? 0, shape: r0[0]?.t, priced: r0[0]?.priced, groups: r0.slice(0, 4).map((g) => `${g.t} n=${g.n} priced=${g.priced.toFixed(2)}`), first: r0[0]?.urls.slice(0, 6).map((u) => new URL(u).pathname) };
      const rounds: number[] = [];
      let quiet = 0;
      for (let i = 0; i < 15 && quiet < 2; i++) {
        const prev = (await page.evaluate(`document.querySelectorAll('a[href]').length`)) as number;
        // step down the page in viewport steps (lazy loaders watch intersection), then try a load-more button
        await page.evaluate(`(async () => { const h = document.documentElement.scrollHeight; for (let y = window.scrollY; y < h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, document.documentElement.scrollHeight); })()`);
        await page.waitForTimeout(1500);
        const more = page.locator('button:visible, a:visible').filter({ hasText: /^(\s*)(load more|show more|view more|mehr (anzeigen|laden)|weitere|see more|more products)/i }).first();
        if (await more.isVisible({ timeout: 300 }).catch(() => false)) { await more.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(2000); res.loadMore = (res.loadMore ?? 0) + 1; }
        const now = (await page.evaluate(`document.querySelectorAll('a[href]').length`)) as number;
        const h = await page.evaluate(CARD_SCRIPT);
        rounds.push(cardRule(h.anchors, url)[0]?.n ?? 0);
        quiet = now > prev ? 0 : quiet + 1;
      }
      const h1 = await page.evaluate(CARD_SCRIPT); writeFileSync(`${OUT}/${site}-anchors.json`, JSON.stringify({ before: h0.anchors, after: h1.anchors, shipped: anchors }));
      const r1 = cardRule(h1.anchors, url);
      const shipped1 = largestProductGroup(h1.anchors, url);
      res.after = { cards: r1[0]?.n ?? 0, shape: r1[0]?.t, groups: r1.slice(0, 4).map((g) => `${g.t} n=${g.n} priced=${g.priced.toFixed(2)}`), rounds, shippedGroupAfterScroll: shipped1.length, sample: r1[0]?.urls.slice(0, 10).map((u) => new URL(u).pathname) };
      await page.screenshot({ path: `${OUT}/${site}-top.png` }).catch(() => {});
      // 3. Shopify feed, if the listing is a collection
      const fu = page.url();
      if (/\/collections\/[^/]+/.test(new URL(fu).pathname)) {
        const feed = fu.split("?")[0].replace(/\/+$/, '') + '/products.json?limit=250';
        const r = await page.request.get(feed, { timeout: 15_000 }).catch(() => null);
        if (r && r.ok()) { try { const j = await r.json(); res.shopifyFeed = { products: j.products?.length, variants: j.products?.reduce((s: number, p: any) => s + (p.variants?.length ?? 0), 0) }; } catch { res.shopifyFeed = 'not json'; } }
        else res.shopifyFeed = r ? `HTTP ${r.status()}` : 'failed';
      }
    } finally { await page.close(); }
  } catch (err) { res.error = (err as Error).message.split('\n')[0]; }
  res.ms = Date.now() - t0;
  writeFileSync(`${OUT}/${site}.json`, JSON.stringify(res, null, 2));
  console.log(JSON.stringify({ site, verdict: res.verdict, final: res.finalUrl, finder: res.finder?.n, finderDistinct: res.finder?.distinctPaths, before: res.before?.cards, after: res.after?.cards, rounds: res.after?.rounds, shippedAfter: res.after?.shippedGroupAfterScroll, feed: res.shopifyFeed, err: res.error }));
}
await b.close();
