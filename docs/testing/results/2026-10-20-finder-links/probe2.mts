// Throwaway: richer per-anchor harvest of the live listing (no scrolling), for offline rule iteration. Free.
import { writeFileSync } from 'node:fs';
import { PlaywrightBrowser } from 'file:///C:/Users/Marko/Documents/projects/robot-platform/packages/browser/src/index.ts';
const OUT = 'C:/Users/Marko/AppData/Local/Temp/claude/C--Users-Marko-Documents-projects-robot-platform/a75cfd11-80b1-4ff8-b301-282f0da03222/scratchpad/finder/out2';
const ALL: Record<string, string> = {
  bombas: 'https://bombas.com/collections/mens-socks', burrow: 'https://burrow.com/collections/sofas',
  'thomann-cat': 'https://www.thomann.de/de/gitarren_baesse.html', thomann: 'https://www.thomann.de/de/4-4_konzertgitarren.html',
  lacoste: 'https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/', ikea: 'https://www.ikea.com/my/en/cat/sofas-fu003/',
  'ikea-blog': 'https://www.ikea.com/global/en/stories/ideas-inspiration/style-report-modern-nordic-warmth-260617/',
  noths: 'https://www.notonthehighstreet.com/sale/jewellery-sale', ruggable: 'https://ruggable.com/collections/shop-all',
  skullcandy: 'https://www.skullcandy.com/collections/shop-all', puma: 'https://us.puma.com/us/en/men/shoes',
  gymshark: 'https://www.gymshark.com/collections/all-products/womens', ridge: 'https://ridge.com/collections/wallets',
};
const pick = process.argv.slice(2);
const SCRIPT = String.raw`(() => {
  const PRICE = /(?:[$\u20ac\u00a3\u00a5]|RM|MYR|USD|EUR|GBP|AED|CHF)\s?\d|\d[\d.,]*\s?(?:\u20ac|\u00a3|\$|RM|AED|kr|CHF)/;
  const norm = (h) => { try { const u = new URL(h, location.href); return u.host + u.pathname.replace(/\/+$/, ''); } catch { return null; } };
  const sig = (el) => el.tagName + '.' + ((el.getAttribute('class') || '').trim().split(/\s+/).sort().join('.'));
  const tag = (el) => el.tagName;
  const chrome = (a) => {
    if (a.closest('nav, aside, [role~=navigation i], [role~=banner i], [role~=contentinfo i], [role~=complementary i]')) return true;
    const hf = a.closest('header, footer');
    return !!hf && !(hf.parentElement && hf.parentElement.closest('article, section, main, aside, nav'));
  };
  const memo = new Map();
  const info = (el) => {
    if (memo.has(el)) return memo.get(el);
    const set = new Set(); for (const x of el.querySelectorAll('a[href]')) { const n = norm(x.getAttribute('href')); if (n) set.add(n); }
    let txt = el.innerText || '';
    const p = el.parentElement; let rep = 0, repTag = 0;
    if (p) { const s = sig(el), t = tag(el); for (const c of p.children) { if (sig(c) === s) rep++; if (tag(c) === t) repTag++; } }
    const r = { d: set.size, img: !!el.querySelector('img, picture'), price: PRICE.test(txt), len: txt.length, rep, repTag };
    memo.set(el, r); return r;
  };
  const swatchy = (a) => !!a.closest('[role=radio], [role=radiogroup], [aria-checked], [class*=swatch i], [data-swatch]') || /^\+\s?\d+$/.test((a.textContent || '').trim());
  const anchors = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const lv = []; let el = a.parentElement;
    for (let i = 0; el && el !== document.body && i < 8; i++, el = el.parentElement) lv.push(info(el));
    const r = a.getBoundingClientRect();
    anchors.push({ href: a.getAttribute('href') || '', text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), chrome: chrome(a), swatch: swatchy(a),
      selfPrice: PRICE.test(a.innerText || ''), selfImg: !!a.querySelector('img, picture'), visible: r.width > 0 && r.height > 0, y: Math.round(r.top + scrollY), lv });
  }
  const itemList = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { const walk = (x) => { if (Array.isArray(x)) return x.forEach(walk); if (x && typeof x === 'object') { if (x['@type'] === 'ItemList' && Array.isArray(x.itemListElement)) for (const e of x.itemListElement) itemList.push(e.url || (e.item && (e.item.url || e.item['@id'])) || null); if (x['@graph']) walk(x['@graph']); } }; walk(JSON.parse(s.textContent || '')); } catch {}
  }
  return { url: location.href, anchors, itemList };
})()`;
const b = new PlaywrightBrowser(); await b.launch(); const anyB = b as any;
for (const [site, url] of Object.entries(ALL).filter(([k]) => pick.length === 0 || pick.includes(k))) {
  const page = await anyB.context.newPage();
  try {
    await anyB.navigateWithFallback(page, url, { waitUntil: 'networkidle', timeout: 20_000 });
    await anyB.dismissPopups(page);
    const h = await page.evaluate(SCRIPT);
    writeFileSync(`${OUT}/${site}.json`, JSON.stringify(h));
    console.log(JSON.stringify({ site, anchors: h.anchors.length, itemList: h.itemList.length }));
  } catch (e) { console.log(JSON.stringify({ site, err: (e as Error).message.split('\n')[0] })); }
  finally { await page.close(); }
}
await b.close();
