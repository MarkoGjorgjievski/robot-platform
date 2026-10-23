// A deterministic local shop for the run-speed benchmark (spec 2026-10-23 run speed §5.1). Website `s` listens on
// 127.0.0.(11+s) — its own hostname, so the domain lock paces it as its own host. Products /p/<id> carry JSON-LD,
// meta, an API the page fetches, XPath-only fields, a "Read more" description, a details panel, popups and
// latency shaped like the real product pages measured on 2026-10-23. Free; loopback only.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CertifiedPath, CustomerFieldType } from '@robot/scraper';
import { normalize, renderValue } from '@robot/scraper';

export type FixtureLatency = { htmlMs: [number, number]; slowExtraMs: number; slowShare: number; cssMs: number; imageMs: number; apiMs: [number, number] };
/** ~2 s to `load`, like the real pages: HTML 0.6–0.9 s (5 % +2.5 s), a render-blocking stylesheet, three images. */
export const REALISTIC: FixtureLatency = { htmlMs: [600, 900], slowExtraMs: 2500, slowShare: 0.05, cssMs: 300, imageMs: 1200, apiMs: [300, 900] };
export const INSTANT: FixtureLatency = { htmlMs: [0, 0], slowExtraMs: 0, slowShare: 0, cssMs: 0, imageMs: 0, apiMs: [0, 0] };

export type FixtureSite = { index: number; host: string; origin: string; consentGated: boolean; productUrl(id: number): string };
export type FixtureShop = { sites: FixtureSite[]; close(): Promise<void> };

/** A deterministic number in [0, 1) for (site, id, salt). */
export function unit(site: number, id: number, salt: string): number {
  let h = 2166136261;
  for (const ch of `${site}:${id}:${salt}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10_000) / 10_000;
}
const between = ([lo, hi]: [number, number], u: number) => Math.round(lo + (hi - lo) * u);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type ProductTruth = {
  title: string; sku: string; price: string; brand: string; stock: string; rating: string | null;
  description: string; materials: string; cookie: boolean; newsletter: boolean; readMore: boolean;
};
export type TruthKey = 'title' | 'sku' | 'price' | 'brand' | 'stock' | 'rating' | 'description' | 'materials';

export function product(site: number, id: number): ProductTruth {
  const readMore = id % 3 === 0;
  return {
    title: `Fixture ${site}-${id} Lamp`,
    sku: `FX-${site}-${id}`,
    price: (9.99 + ((site * 31 + id * 7) % 200)).toFixed(2),
    brand: `Brand ${(site + id) % 7}`,
    stock: (site * 3 + id) % 11 === 0 ? 'Sold out' : 'In stock',
    rating: id % 10 === 7 ? null : (3 + ((site + id) % 20) / 10).toFixed(1),
    description: readMore ? `The long story of lamp ${site}-${id}, told in full once you ask for it.` : `Lamp ${site}-${id}, short and sweet.`,
    materials: `Steel ${(id * 13) % 100}%, glass`,
    cookie: unit(site, id, 'cookie') < 0.5,
    newsletter: unit(site, id, 'news') < 0.2,
    readMore,
  };
}

export type FixtureField = { name: string; type: CustomerFieldType; truth: TruthKey; paths: CertifiedPath[] };
const p = (source: CertifiedPath['source'], path: string): CertifiedPath => ({ source, path, transform: 'identity' });
export const FIXTURE_FIELDS: FixtureField[] = [
  { name: 'Title', type: 'text', truth: 'title', paths: [p('json-ld', 'name')] },
  { name: 'SKU', type: 'text', truth: 'sku', paths: [p('json-ld', 'sku')] },
  { name: 'Price', type: 'money', truth: 'price', paths: [p('api', 'price'), p('json-ld', 'offers.price')] },
  { name: 'Brand', type: 'text', truth: 'brand', paths: [p('xpath', '//div[@class="brand"]')] },
  { name: 'Stock', type: 'text', truth: 'stock', paths: [p('xpath', '//div[@id="stock"]')] },
  { name: 'Rating', type: 'number', truth: 'rating', paths: [p('xpath', '//div[@class="rating"]/span[@class="score"]')] },
  { name: 'Description', type: 'text', truth: 'description', paths: [p('xpath', '//div[@class="desc"]/p[@class="text"]')] },
  { name: 'Materials', type: 'text', truth: 'materials', paths: [p('xpath', '//details/p[@class="materials"]')] },
];

/** What a run should write per field name: the truth rendered the way `runVerifiedExtraction` renders a hit. */
export function renderedTruth(t: ProductTruth): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIXTURE_FIELDS) {
    const raw = t[f.truth];
    if (raw === null) { out[f.name] = null; continue; }
    if (f.type === 'text') { out[f.name] = String(raw).normalize('NFKC').replace(/\s+/g, ' ').trim(); continue; }
    const n = normalize(f.type, raw);
    out[f.name] = n === null ? null : renderValue(f.type, n);
  }
  return out;
}

function productHtml(site: FixtureSite, id: number, t: ProductTruth): string {
  const shown = t.readMore ? `${t.description.slice(0, 24)}…` : t.description;
  const notes = Array.from({ length: 12 }, (_, k) => `<p>Note ${k + 1} on ${esc(t.title)}: hand finished, tested for daily use, delivered in recyclable packaging with care instructions.</p>`).join('');
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: t.title, sku: t.sku, offers: { '@type': 'Offer', price: t.price, priceCurrency: 'EUR' } };
  const showCookie = t.cookie || site.consentGated;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(t.title)}</title>
<meta property="og:title" content="${esc(t.title)}">
<link rel="stylesheet" href="/static/site.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head><body><header><nav>Fixture shop ${site.index}</nav></header><main>
<h1>${esc(t.title)}</h1>
<div class="brand">${esc(t.brand)}</div>
<div class="sku">SKU: ${esc(t.sku)}</div>
<div class="price">€${t.price}</div>
<div id="stock"></div>
${t.rating === null ? '' : `<div class="rating"><span class="score">${t.rating}</span> out of 5</div>`}
<div class="desc"><p class="text">${esc(shown)}</p>${t.readMore ? '<button type="button" class="read-more" aria-expanded="false">Read more</button>' : ''}</div>
<details><summary>Materials</summary><p class="materials">${esc(t.materials)}</p></details>
<section class="notes">${notes}</section>
<img src="/img/${id}-1.svg" alt=""><img src="/img/${id}-2.svg" alt=""><img src="/img/${id}-3.svg" alt="">
</main>
<script>
(function () {
  var gated = ${site.consentGated};
  var consent = document.cookie.indexOf('consent=1') >= 0;
  var stock = document.getElementById('stock');
  var last = null;
  function fill(j) { stock.textContent = j.stock ? 'In stock' : 'Sold out'; }
  fetch('/api/product/${id}').then(function (r) { return r.json(); }).then(function (j) { last = j; if (!gated || consent) fill(j); });
  ${t.readMore ? `document.querySelector('.read-more').addEventListener('click', function () { document.querySelector('.desc .text').textContent = ${JSON.stringify(t.description)}; this.setAttribute('aria-expanded', 'true'); });` : ''}
  if (${showCookie} && !consent) setTimeout(function () {
    var d = document.createElement('div');
    d.id = 'cookie-consent'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Cookies');
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000';
    d.innerHTML = '<div style="background:#fff;margin:20vh auto;width:420px;padding:24px"><h2>We use cookies</h2><p>To run the shop.</p><button type="button" class="accept">Accept all</button></div>';
    d.querySelector('.accept').addEventListener('click', function () { document.cookie = 'consent=1; path=/'; d.remove(); if (gated && last) fill(last); });
    document.body.appendChild(d);
  }, 400);
  if (${t.newsletter}) setTimeout(function () {
    var n = document.createElement('div');
    n.className = 'newsletter-popup';
    n.style.cssText = 'position:fixed;right:24px;bottom:24px;width:360px;height:260px;background:#fff;border:1px solid #999;z-index:900';
    n.innerHTML = '<button type="button" class="close" aria-label="Close">×</button><h3>Join our newsletter</h3><p>Ten percent off your first order.</p>';
    n.querySelector('.close').addEventListener('click', function () { n.remove(); });
    document.body.appendChild(n);
  }, 1200);
})();
</script></body></html>`;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#ccc"/></svg>';

function handler(site: FixtureSite, lat: FixtureLatency) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', site.origin).pathname;
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/p\/(\d+)$/))) {
      const id = Number(m[1]);
      const slow = unit(site.index, id, 'slow') < lat.slowShare;
      await sleep(between(lat.htmlMs, unit(site.index, id, 'html')) + (slow ? lat.slowExtraMs : 0));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(productHtml(site, id, product(site.index, id)));
    }
    if ((m = path.match(/^\/api\/product\/(\d+)$/))) {
      const id = Number(m[1]);
      const t = product(site.index, id);
      await sleep(between(lat.apiMs, unit(site.index, id, 'api')));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id, name: t.title, price: t.price, stock: t.stock === 'In stock', note: 'fixture product payload for the run-speed benchmark' }));
    }
    if (path === '/static/site.css') {
      await sleep(lat.cssMs);
      res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'max-age=3600' });
      return res.end('body{font-family:sans-serif;max-width:960px;margin:0 auto}.price{font-weight:bold}');
    }
    if (path.startsWith('/img/')) {
      await sleep(lat.imageMs);
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      return res.end(SVG);
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  };
}

export async function startFixtureShop(opts: { sites: number; latency?: FixtureLatency }): Promise<FixtureShop> {
  const lat = opts.latency ?? REALISTIC;
  const servers: Server[] = [];
  const sites: FixtureSite[] = [];
  for (let i = 0; i < opts.sites; i++) {
    const host = `127.0.0.${11 + i}`;
    const site: FixtureSite = { index: i, host, origin: '', consentGated: opts.sites >= 4 && i === opts.sites - 1, productUrl: (id) => `${site.origin}/p/${id}` };
    const server = createServer((req, res) => { void handler(site, lat)(req, res); });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, host, () => resolve()); });
    site.origin = `http://${host}:${(server.address() as AddressInfo).port}`;
    servers.push(server);
    sites.push(site);
  }
  return {
    sites,
    close: async () => { await Promise.all(servers.map((s) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); }))); },
  };
}
