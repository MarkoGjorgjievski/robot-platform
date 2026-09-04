import type { CustomerFieldType } from './types.js';

export type DomNeedle = { key: string; type: CustomerFieldType; expected: string };
export type DomHit = { key: string; xpath: string; raw: string };
export type XPathProbeResult = Record<string, string | null>;

/** Runs INSIDE the page. Keep it dependency-free: it is stringified into the script. */
function browserNormalize(type: string, raw: string, pageUrl: string): string | null {
  const t = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  const num = (s: string): number | null => {
    let x = s.replace(/[A-Za-z$€£¥₹\s]/g, '').replace(/^[^\d\-+.,]+|[^\d.,]+$/g, '');
    if (!/^[-+]?[\d.,]+$/.test(x) || !/\d/.test(x)) return null;
    const lc = x.lastIndexOf(','), ld = x.lastIndexOf('.');
    if (lc > -1 && ld > -1) x = lc > ld ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
    else if (lc > -1) { const g = x.split(','); x = g.length === 2 && g[1]!.length !== 3 ? x.replace(',', '.') : x.replace(/,/g, ''); }
    else if (ld > -1) { const g = x.split('.'); if (g.length > 2) x = x.replace(/\./g, ''); }
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  const TRUE = ['true', 'yes', 'y', '1', 'in stock', 'instock', 'available', 'in-stock', 'https://schema.org/instock'];
  const FALSE = ['false', 'no', 'n', '0', 'out of stock', 'outofstock', 'unavailable', 'sold out', 'https://schema.org/outofstock'];
  switch (type) {
    case 'text': return t.toLowerCase();
    case 'number': { const n = num(t); return n === null ? null : String(n); }
    case 'money': { const n = num(t); return n === null ? null : (Math.round(n * 100) / 100).toFixed(2); }
    case 'boolean': { const l = t.toLowerCase(); return TRUE.includes(l) ? 'true' : FALSE.includes(l) ? 'false' : null; }
    case 'date': {
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
      const d = Date.parse(t);
      if (Number.isNaN(d)) return null;
      const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(t) && /T\d{2}:\d{2}/.test(t);
      const x = new Date(d);
      return zoned ? x.toISOString().slice(0, 10) : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    }
    case 'url':
    case 'image': { try { const u = new URL(t, pageUrl); if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; u.hash = ''; u.hostname = u.hostname.toLowerCase(); return u.href; } catch { return null; } }
    case 'text_list': { const items = t.split(/[\n,;]/).map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean); return items.length ? Array.from(new Set(items)).sort().join(' ') : null; }
    default: return null;
  }
}

/** Runs INSIDE the page. Structural XPath to an element: id anchor, else data-* anchor, else body. */
function browserXPath(el: Element): string {
  const step = (e: Element): string => {
    const tag = e.tagName.toLowerCase();
    const cls = (e.getAttribute('class') ?? '').trim();
    if (cls) return `${tag}[@class="${cls.replace(/"/g, '')}"]`;
    let i = 1;
    let s = e.previousElementSibling;
    while (s) { if (s.tagName === e.tagName) i++; s = s.previousElementSibling; }
    return `${tag}[${i}]`;
  };
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName.toLowerCase() !== 'body') {
    const id = cur.getAttribute('id');
    if (id) return `//*[@id="${id.replace(/"/g, '')}"]` + (parts.length ? '/' + parts.join('/') : '');
    const data = Array.from(cur.attributes).find((a) => a.name.startsWith('data-') && a.value !== '');
    if (data && cur !== el) return `//${cur.tagName.toLowerCase()}[@${data.name}="${data.value.replace(/"/g, '')}"]` + (parts.length ? '/' + parts.join('/') : '');
    parts.unshift(step(cur));
    cur = cur.parentElement;
  }
  return '//body' + (parts.length ? '/' + parts.join('/') : '');
}

export function buildDomSearchScript(needles: DomNeedle[], pageUrl: string): string {
  return `(() => {
    const normalize = ${browserNormalize.toString()};
    const xpathOf = ${browserXPath.toString()};
    const needles = ${JSON.stringify(needles)};
    const pageUrl = ${JSON.stringify(pageUrl)};
    const wanted = needles.map((n) => ({ ...n, norm: normalize(n.type, n.expected, pageUrl) })).filter((n) => n.norm !== null);
    const hits = [];
    const consider = (el, raw, attr) => {
      if (raw == null || String(raw).trim() === '') return;
      for (const n of wanted) {
        if (normalize(n.type, String(raw), pageUrl) !== n.norm) continue;
        hits.push({ key: n.key, xpath: xpathOf(el) + (attr ? '/@' + attr : ''), raw: String(raw) });
      }
    };
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (const el of all) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;
      if (el.children.length === 0) consider(el, el.textContent, null);
      if (el.hasAttribute('href')) consider(el, el.getAttribute('href'), 'href');
      if (el.hasAttribute('src')) consider(el, el.getAttribute('src'), 'src');
      if (el.hasAttribute('content')) consider(el, el.getAttribute('content'), 'content');
    }
    return hits;
  })()`;
}

export function buildXPathProbeScript(xpaths: string[]): string {
  return `(() => {
    const out = {};
    for (const xp of ${JSON.stringify(xpaths)}) {
      try {
        const m = xp.match(/^(.*)\\/@([a-zA-Z_:-]+)$/);
        const base = m ? m[1] : xp;
        const r = document.evaluate(base, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const node = r.singleNodeValue;
        if (!node) { out[xp] = null; continue; }
        const v = m ? node.getAttribute(m[2]) : (node.textContent ?? '');
        out[xp] = v == null || String(v).trim() === '' ? null : String(v).trim();
      } catch { out[xp] = null; }
    }
    return out;
  })()`;
}

export function xpathContainsValue(xpath: string, expected: string): boolean {
  const fold = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  const e = fold(expected);
  return e.length > 0 && fold(xpath).includes(e);
}
