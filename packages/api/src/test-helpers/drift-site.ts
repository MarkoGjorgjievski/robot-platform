// packages/api/src/test-helpers/drift-site.ts
// A tiny `node:http` server on 127.0.0.1 (a random port), for the drift
// check's end-to-end test: real Chromium captures three product pages from
// it, in two layouts `setLayout` can switch between live.
//
// Layout A: the price is both in the JSON-LD (`offers.price`) and shown on
// the page in a `.price` element — the shape `runDriftCheck`'s certification
// is seeded against. Layout B: the JSON-LD drops `offers` entirely (no price
// to read there any more) and the same price moves to a `.amount` element —
// a mechanically findable candidate the certifier's own search should pick
// up as `moved`. The title's own path (JSON-LD `name`) is unchanged in both
// layouts, so a field certified on it alone should read `other-layout`.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type DriftLayout = 'A' | 'B';

const PRODUCTS = [
  { path: '/p/1', title: 'Widget A', price: '129.99' },
  { path: '/p/2', title: 'Widget B', price: '219.99' },
  { path: '/p/3', title: 'Widget C', price: '149.00' },
] as const;

function productPage(product: (typeof PRODUCTS)[number], layout: DriftLayout): string {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    ...(layout === 'A' ? { offers: { '@type': 'Offer', price: product.price, priceCurrency: 'USD' } } : {}),
  };
  const priceHtml = layout === 'A' ? `<span class="price">$${product.price}</span>` : `<div class="amount">$${product.price}</div>`;
  return (
    `<html><head><title>${product.title}</title>` +
    `<script type="application/ld+json">${JSON.stringify(ld)}</script></head>` +
    `<body><h1>${product.title}</h1>${priceHtml}<p>A product page for the drift check's own test site.</p></body></html>`
  );
}

export type DriftSite = {
  server: Server;
  origin: string;
  /** The three product pages' urls, in `PRODUCTS`' order. */
  urls: string[];
  setLayout: (layout: DriftLayout) => void;
  close: () => Promise<void>;
};

/** Starts the server; every page renders in layout `A` until `setLayout('B')` is called. */
export function startDriftSite(): Promise<DriftSite> {
  let layout: DriftLayout = 'A';
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    const product = PRODUCTS.find((p) => p.path === pathname);
    if (!product) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(productPage(product, layout));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve({
        server,
        origin,
        urls: PRODUCTS.map((p) => `${origin}${p.path}`),
        setLayout: (l) => { layout = l; },
        close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
      });
    });
  });
}
