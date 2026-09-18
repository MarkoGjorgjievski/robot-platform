import type { CustomerFieldType } from './types.js';

export type DomNeedle = { key: string; type: CustomerFieldType; expected: string };
export type DomHit = { key: string; xpath: string; raw: string };
export type XPathProbeResult = Record<string, string | null>;

/**
 * Runs INSIDE the page, as the first statement of every injected IIFE.
 *
 * Under the dev runtime (`tsx watch` → esbuild with `keepNames: true`), the transformed
 * source of a stringified function wraps its nested arrows in esbuild's `__name(fn, name)`
 * helper — `Function.prototype.toString()` returns that post-transform source, not the
 * original TypeScript. The page never defines `__name` itself, so the first call into a
 * stringified function throws `ReferenceError: __name is not defined`. `var` (not `const`)
 * so this is hoisted and harmless if esbuild's own `__name` helper is also present.
 */
export const PAGE_SCRIPT_PRELUDE = 'var __name = (fn) => fn;';

/** Runs INSIDE the page. Keep it dependency-free: it is stringified into the script. */
function browserNormalize(type: string, raw: string, pageUrl: string): string | null {
  const t = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  const num = (s: string, mode: 'number' | 'money'): number | null => {
    let x = s.replace(/[A-Za-z$€£¥₹\s]/g, '').replace(/^[^\d\-+.,]+|[^\d.,]+$/g, '');
    if (!/^[-+]?[\d.,]+$/.test(x) || !/\d/.test(x)) return null;
    const lc = x.lastIndexOf(','), ld = x.lastIndexOf('.');
    if (lc > -1 && ld > -1) x = lc > ld ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
    else if (lc > -1) { const g = x.split(','); x = g.length === 2 && g[1]!.length !== 3 ? x.replace(',', '.') : x.replace(/,/g, ''); }
    else if (ld > -1) {
      const g = x.split('.');
      // For money: a single 3-digit group is thousands (1.299 € = 1299). For number: it's decimal (1.299).
      if (g.length > 2) x = x.replace(/\./g, '');
      else if (mode === 'money' && g.length === 2 && g[1]!.length === 3) x = x.replace(/\./g, '');
      // For number type, leave single dots as-is (they represent decimals)
    }
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  const TRUE = ['true', 'yes', 'y', '1', 'in stock', 'instock', 'available', 'in-stock', 'https://schema.org/instock'];
  const FALSE = ['false', 'no', 'n', '0', 'out of stock', 'outofstock', 'unavailable', 'sold out', 'https://schema.org/outofstock'];
  switch (type) {
    case 'text': return t.toLowerCase();
    case 'number': { const n = num(t, 'number'); return n === null ? null : String(n); }
    case 'money': { const n = num(t, 'money'); return n === null ? null : (Math.round(n * 100) / 100).toFixed(2); }
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
/**
 * Does this attribute value look machine-generated, so that it will change on
 * the site's next deploy (or differ from product to product)?
 *
 * An XPath anchored on such a value certifies today and goes empty later with
 * no warning. Found on Ikea, 2026-09-17: `data-cv="634a7e0"` (a build hash,
 * already "a14a902" a week later) and `data-skapa="price-module@11.1.8"` (a
 * version stamp; the ONLY certified path for a whole column was anchored on it).
 *
 * Errs toward "volatile": skipping a stable anchor only makes the XPath take
 * the next anchor up or a position, while keeping a volatile one loses data.
 *
 * Runs in Node (certify, tests) AND inside the page (serialised with
 * toString() into buildDomSearchScript), so it must stay self-contained: no
 * imports, no closures over module state.
 */
export function looksVolatile(value: string): boolean {
  const v = value.trim();
  if (v === '') return false;
  // A state value says something about THIS product ("data-online-sellable=true"), not where a field lives:
  // the next product may carry the other value, and the XPath would miss it.
  if (/^(true|false|yes|no|on|off|null|undefined|\d{1,4})$/i.test(v)) return true;
  if (/\d+\.\d+/.test(v)) return true;                          // a version stamp, or a decimal: "price-module@11.1.8"
  if (/\d{5,}/.test(v)) return true;                             // a long number: a product, build or session id
  if (/^:[A-Za-z][A-Za-z0-9]*:$/.test(v)) return true;           // React useId: ":r1:"
  if (/^(css|sc|jsx|jss|emotion)-[A-Za-z0-9]{4,}$/.test(v)) return true; // CSS-in-JS class names
  for (const seg of v.split(/[^A-Za-z0-9]+/)) {
    if (seg.length < 5) continue;
    const digits = seg.replace(/[^0-9]/g, '').length;
    const letters = seg.length - digits;
    // Letters and digits interleaved ("634a7e0", "3kX9a") is a hash; a word with a
    // number on one end ("step3", "col12", "2xl") is a name.
    if (digits >= 2 && letters >= 2 && !/^[A-Za-z]+[0-9]+$/.test(seg) && !/^[0-9]+[A-Za-z]+$/.test(seg)) return true;
  }
  return false;
}

/** Is any attribute literal in this XPath volatile? Class literals are checked token by token. */
export function isVolatileXPath(xpath: string): boolean {
  // Every double-quoted literal: @attr="…" and the class-token predicate's " token ". The bare " " of
  // that predicate's concat() trims to nothing and is skipped.
  for (const m of xpath.matchAll(/"([^"]*)"/g)) {
    const literal = m[1]!.trim();
    if (literal === '') continue;
    if (looksVolatile(literal) || literal.split(/\s+/).some((t) => looksVolatile(t))) return true;
  }
  return false;
}

/**
 * Up to MAX_XPATH_VARIANTS XPaths for one element, nearest anchor first.
 *
 * One XPath per STABLE anchor met on the way up (an id, or a data-* attribute
 * of an ancestor), then the body-rooted path. Several, because a single page
 * cannot tell a stable anchor from a product-specific one: on Ikea the nearest
 * stable-looking anchor for the subtitle was `data-product-name="KIVIK"`,
 * which is right on that page and wrong on every other product. The proof
 * pages decide: a product-specific variant fails the other pages, a shared one
 * passes them all, and certify ranks the shorter one first when both do.
 *
 * Exported for box-map.ts, which stringifies it the same way.
 */
export function browserXPaths(el: Element): string[] {
  const MAX_XPATH_VARIANTS = 3;
  const step = (e: Element): string => {
    const tag = e.tagName.toLowerCase();
    const cls = (e.getAttribute('class') ?? '').trim();
    // A class list often carries STATE next to structure: a BEM modifier ("price-module--bti" on one
    // product, "--none" on the next), "is-active", "open". Matching the whole string gives the same
    // element a different XPath per product. So: the exact string only when every token is structural;
    // otherwise the first structural token, as a whole-token match; with none (all generated), the position.
    const tokens = cls.split(/\s+/).filter((t) => t !== '');
    const isState = (t: string) => t.includes('--') || /^(is|has)-/.test(t) || /^(active|selected|current|open|closed|opened|expanded|collapsed|disabled|enabled|hidden|visible|loading|loaded|checked|focused|hover)$/.test(t);
    const structural = tokens.filter((t) => !looksVolatile(t) && !isState(t));
    if (tokens.length > 0 && structural.length === tokens.length && !looksVolatile(cls)) return `${tag}[@class="${cls.replace(/"/g, '')}"]`;
    if (structural.length > 0) return `${tag}[contains(concat(" ",normalize-space(@class)," ")," ${structural[0]!.replace(/"/g, '')} ")]`;
    let i = 1;
    let s = e.previousElementSibling;
    while (s) { if (s.tagName === e.tagName) i++; s = s.previousElementSibling; }
    return `${tag}[${i}]`;
  };
  const out: string[] = [];
  const parts: string[] = [];
  const tail = () => (parts.length ? '/' + parts.join('/') : '');
  let cur: Element | null = el;
  while (cur && cur.tagName.toLowerCase() !== 'body') {
    // An id on the matched element itself is a legitimate anchor (the strongest locator) —
    // unlike data-*, which only anchors on an ANCESTOR (checked via `cur !== el` below).
    // A generated id (":r1:", "item-10489009") or data value ("634a7e0", "price-module@11.1.8", "true")
    // is skipped: the walk goes on to the next stable anchor further up.
    const id = cur.getAttribute('id');
    const data = Array.from(cur.attributes).find((a) => a.name.startsWith('data-') && a.value !== '' && !looksVolatile(a.value));
    if (out.length < MAX_XPATH_VARIANTS - 1) {
      if (id && !looksVolatile(id)) out.push(`//*[@id="${id.replace(/"/g, '')}"]` + tail());
      else if (data && cur !== el) out.push(`//${cur.tagName.toLowerCase()}[@${data.name}="${data.value.replace(/"/g, '')}"]` + tail());
    }
    parts.unshift(step(cur));
    cur = cur.parentElement;
  }
  out.push('//body' + tail());
  return out;
}

export function buildDomSearchScript(needles: DomNeedle[], pageUrl: string): string {
  return `(() => {
    ${PAGE_SCRIPT_PRELUDE}
    const normalize = ${browserNormalize.toString()};
    const looksVolatile = ${looksVolatile.toString()};
    const xpathsOf = ${browserXPaths.toString()};
    const needles = ${JSON.stringify(needles)};
    const pageUrl = ${JSON.stringify(pageUrl)};
    const wanted = needles.map((n) => ({ ...n, norm: normalize(n.type, n.expected, pageUrl) })).filter((n) => n.norm !== null);
    const hits = [];
    const consider = (el, raw, attr) => {
      if (raw == null || String(raw).trim() === '') return;
      for (const n of wanted) {
        if (normalize(n.type, String(raw), pageUrl) !== n.norm) continue;
        for (const xp of xpathsOf(el)) hits.push({ key: n.key, xpath: xp + (attr ? '/@' + attr : ''), raw: String(raw) });
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
    ${PAGE_SCRIPT_PRELUDE}
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
  if (e.length === 0) return false;
  // Structural attribute-equality literals (@class="now", @data-x='red', @id="...") are locators,
  // not literal-value predicates — blank them out before the substring check so a coincidental
  // match on a class/id/data-* value (e.g. expected "now" vs @class="now") is not rejected.
  const withoutAttrLiterals = xpath
    .replace(/@[\w:-]+=(?:"[^"]*"|'[^']*')/g, (m) => `${m.slice(0, m.indexOf('='))}=""`)
    // The generator's whole-token class match: contains(concat(" ",normalize-space(@class)," ")," token ").
    .replace(/normalize-space\(@class\)," "\)," [^"]* "\)/g, 'normalize-space(@class)," "),"")');
  return fold(withoutAttrLiterals).includes(e);
}
