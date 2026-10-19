// Test-only: fixture product pages for the capture-overlay tests, served over real HTTP so
// capture() navigates as it does on a site. Every requested path is logged, so a test can prove
// that a link was never followed.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface HtmlSite {
  baseUrl: string;
  /** Every path requested, in order (query strings dropped). */
  requested: string[];
  close(): Promise<void>;
}

/** Serve `pages` (path → HTML); anything else is a small 404 page. */
export async function serveHtml(pages: Record<string, string>): Promise<HtmlSite> {
  const requested: string[] = [];
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    requested.push(path);
    const html = pages[path];
    if (html === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><title>Not found</title></head><body><h1>Not found</h1></body></html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    requested,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * The page's own bookkeeping: every click on an element with an id (capture phase, so a click the
 * page swallows still counts), every layer it opens, and free-form flags.
 */
export const TRACK_SCRIPT = `window.__clicks = []; window.__opened = {}; window.__flags = {};
document.addEventListener('click', (e) => {
  const t = e.target && e.target.closest ? e.target.closest('[id]') : null;
  if (t && t.id !== 'product') window.__clicks.push(t.id);
}, true);
function openLayer(id) { const d = document.getElementById(id); d.style.display = 'block'; d.setAttribute('open', ''); window.__opened[id] = (window.__opened[id] || 0) + 1; }
function shutLayer(id) { const d = document.getElementById(id); if (d) { d.style.display = 'none'; d.removeAttribute('open'); } }`;

/**
 * A product page: `main#product` tall enough that the window's centre sits on it, then `outside`
 * (layers, banners), then the bookkeeping and `script`.
 */
export function fixturePage(main: string, outside = '', script = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Widget</title></head>
<body style="margin:0;font:16px sans-serif">
<main id="product" style="min-height:2400px"><h1>Widget</h1><p id="price">$12.50</p>${main}</main>
${outside}
<script>${TRACK_SCRIPT}
${script}</script>
</body></html>`;
}

export interface PageState {
  clicks: string[];
  opened: Record<string, number>;
  flags: Record<string, unknown>;
  /** 'product' when the window's centre is on the product, else the id or tag hit there. */
  centre: string | null;
  shown: Record<string, boolean>;
  exists: Record<string, boolean>;
  pressed: Record<string, string | null>;
  bodyOverflowY: string;
  detailsOpen: Record<string, boolean>;
  scrollY: number;
}

/** An `annotate` script: capture() runs it after its last pass, just before the screenshot. */
export function pageState(ids: string[]): string {
  return `(() => {
  const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  const shown = (id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const ids = ${JSON.stringify(ids)};
  return {
    clicks: window.__clicks || [],
    opened: window.__opened || {},
    flags: window.__flags || {},
    centre: hit && hit.closest('#product') ? 'product' : (hit ? (hit.id || hit.tagName.toLowerCase()) : null),
    shown: Object.fromEntries(ids.map((id) => [id, shown(id)])),
    exists: Object.fromEntries(ids.map((id) => [id, !!document.getElementById(id)])),
    pressed: Object.fromEntries(Array.from(document.querySelectorAll('[aria-pressed][id]')).map((el) => [el.id, el.getAttribute('aria-pressed')])),
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    detailsOpen: Object.fromEntries(Array.from(document.querySelectorAll('details[id]')).map((d) => [d.id, d.open])),
    scrollY: Math.round(window.scrollY),
  };
})()`;
}
