// Served listing pages for the finder's rule (spec 2026-10-20 §6), one per mechanism. Made-up
// shops only (spec §5.1). Served by `serveFixturePages` (../../__fixtures__/serve.ts); images 404,
// which leaves an <img> element on the page — all the card rule asks for.
import type { ServedPage } from '../../__fixtures__/serve.js';

/** Long enough that no page reads as "an empty page" (verdict rule: under 100 characters of text). */
const FILLER = '<p>Free delivery on every order over a modest amount, easy returns within thirty days, and a friendly team who answers every question within a day.</p>';
const page = (body: string, head = '') => `<!doctype html><html><head><title>Listing</title>${head}</head><body>${body}${FILLER}</body></html>`;
const img = (name: string) => `<img src="/img/${encodeURIComponent(name)}.png" alt="">`;
/**
 * A product card: the photo and name in one link, the price in an inline span right after it. Its
 * `innerText` glues the two ("sierra rugRM810.00"): an uppercase code right after a lowercase letter
 * is still a price (`PRICE_PATTERN`, the camel boundary).
 */
export const productCard = (href: string, title: string, price: string, extra = '', cls = 'product-card') =>
  `<li class="${cls}"><a href="${href}">${img(title)}<span>${title}</span></a><span class="price">${price}</span>${extra}</li>`;
/** An image tile: a photo and a name in one link, no price (a category tile, or a price-less product card). */
const imageTile = (href: string, name: string) => `<div class="tile"><a href="${href}">${img(name)}<span>${name}</span></a></div>`;
const grid = (cards: string[]) => `<ul class="grid">${cards.join('')}</ul>`;
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

/** Appends priced cards: on scroll near the bottom (`lazy`), or on a "Load more" click (`button`). */
function growingPage(mode: 'lazy' | 'button', first: number, batches: number, perBatch: number): string {
  const cards = range(first).map((i) => productCard(`/products/oak-chair-${i}`, `Oak chair ${i}`, `$${100 + i}.00`)).join('');
  const trigger = mode === 'lazy'
    ? `addEventListener('scroll', () => { if (scrollY + innerHeight >= document.documentElement.scrollHeight - 50) addBatch(); });`
    : `document.getElementById('more').addEventListener('click', addBatch);`;
  return page(`<ul class="grid" id="grid">${cards}</ul>${mode === 'button' ? '<button id="more">Load more</button>' : ''}<script>
  let next = ${first + 1}, served = 0, last = 0;
  function addBatch() {
    if (served >= ${batches} || Date.now() - last < 300) return;
    served++; last = Date.now();
    const grid = document.getElementById('grid');
    for (let i = 0; i < ${perBatch}; i++, next++) {
      const li = document.createElement('li');
      li.className = 'product-card';
      li.style.height = '200px';
      li.innerHTML = '<a href="/products/oak-chair-' + next + '"><img src="/img/c' + next + '.png" alt=""><span>Oak chair ' + next + '</span></a><div class="price">$' + (100 + next) + '.00</div>';
      grid.appendChild(li);
    }
    if (served >= ${batches} && document.getElementById('more')) document.getElementById('more').remove();
  }
  ${trigger}
</script><style>.product-card { height: 200px; }</style>`);
}

export const LISTING_FIXTURES: ServedPage[] = [
  // A menu of plain-div links (no nav/aside: the old navigation filter let it through) beside a priced grid.
  { path: '/menu', html: page(`<div class="mega-menu">${range(40).map((i) => `<div class="menu-item"><a href="/collections/category-${i}">Category ${i}</a></div>`).join('')}</div>${grid(range(12).map((i) => productCard(`/products/oak-chair-${i}`, `Oak chair ${i}`, `$${100 + i}.00`)))}`) },
  // A handful of category tiles: an image and a name, no price — under the image-card fallback's 6.
  { path: '/tiles', html: page(`<div class="tiles">${range(4).map((i) => imageTile(`/collections/sofas-${i}`, `Sofas ${i}`)).join('')}</div>`) },
  // A listing that shows no prices: eight image cards, one product each (the image-card fallback, §5.2).
  { path: '/image-cards', html: page(`<div class="grid">${range(8).map((i) => imageTile(`/products/linen-throw-${i}`, `Linen throw ${i}`)).join('')}</div>`) },
  // Twelve image tiles inside navigation (a mega-menu's tiles have images) and nothing else: never products.
  { path: '/nav-tiles', html: page(`<nav class="mega-menu">${range(12).map((i) => imageTile(`/collections/wallets-${i}`, `Wallets ${i}`)).join('')}</nav>`) },
  // One shop's product slugs, every kind: the old template split these into five groups.
  { path: '/slugs', html: page(grid(['range-plus-armchair', 'union-3-seat-sofa', 'field-3-piece-sofa', 'shift-sleeper-sofa', 'span-sleeper-sofa', 'arch-nesting-tables']
    .map((s, i) => productCard(`/products/${s}`, s, `£${200 + i}`)))) },
  // Four polos, each card linking its colours by query.
  { path: '/colours', html: page(grid(['a', 'b', 'c', 'd'].map((p) => productCard(`/polo-shirts/polo-${p}?color=red`, `Polo ${p}`, '49,90 €',
    ['blue', 'green'].map((c) => `<a href="/polo-shirts/polo-${p}?color=${c}">${c}</a>`).join(''))))) },
  // Swatch lists (other colour pages) and "+2" links; every card's wrapper names swatches (Review Focus 1).
  { path: '/swatches', html: page(grid(['sierra', 'sundara', 'cyrus', 'impasto', 'kamran'].map((r) => productCard(`/products/${r}-rug`, `${r} rug`, 'RM810.00',
    `<ul class="swatch-list"><li><a href="/products/${r}-rug-blue">blue</a></li><li><a href="/products/${r}-rug-green">green</a></li></ul><a href="/products/${r}-rug">+2</a>`,
    'product-card has-swatches')))) },
  // Four sellers, three products each: /{seller}/product/{slug}.
  { path: '/sellers', html: page(grid(['oakhouse', 'fernly', 'marlow', 'tindle'].flatMap((s) => ['silver-ring', 'gold-hoop', 'pearl-drop']
    .map((p) => productCard(`/${s}/product/${p}`, `${s} ${p}`, '£25'))))) },
  // Products that are not links (clicked by script); the page data lists them.
  { path: '/itemlist', html: page(`<div class="grid">${range(5).map((i) => `<div class="card" onclick="location.href='/p/widget-${i}'">${img(`w${i}`)}<span>Widget ${i}</span><span>$${i}9.00</span></div>`).join('')}</div><a href="/pages/terms">Terms</a>`,
    ld({ '@context': 'https://schema.org', '@type': 'CollectionPage', mainEntity: { '@type': 'ItemList', itemListElement: range(5).map((i) => ({ '@type': 'ListItem', position: i, url: `/p/widget-${i}`, name: `Widget ${i}` })) } })) },
  // No grid: policy pages, a language link, a blog post.
  { path: '/policies', html: page(`<div class="links"><a href="/pages/terms">Terms</a><a href="/policies/refund-policy">Refunds</a><a href="/en-gb/">English (UK)</a><a href="/blogs/news/our-story">Our story</a></div>`) },
  // A grid that grows when scrolled: 6 cards, then 3 batches of 6.
  { path: '/lazy', html: growingPage('lazy', 6, 3, 6) },
  // A grid that grows on "Load more": 6 cards, then 2 batches of 6.
  { path: '/more', html: growingPage('button', 6, 2, 6) },
  // Products named by a query id on a script named like a slug (final review I1): twelve products, not one.
  { path: '/query-ids', html: page(grid(range(12).map((i) => productCard(`/product_info.php?products_id=${i}`, `Oak chair ${i}`, `$${100 + i}.00`)))) },
  // Link text is collapsed whitespace and keeps every letter (`/\s+/`, not `/s+/`).
  { path: '/text', html: page(grid([productCard('/products/tree-runner-1', "Men's   Tree\n Runner Shoes", '$98')])) },
];
