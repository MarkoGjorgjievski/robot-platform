// Does this structured-data block describe the page we asked for?
//
// Barnes & Noble, 2026-08-19: the page is
//   /w/nook-glowlight-4-barnes-noble/1145507276?ean=9780594205821   (a $149.99 e-reader)
// and its single JSON-LD block describes
//   /w/nook-glowlight-4-and-4e-cover-in-daffodil-barnes-noble/1140326163  (a $9.99 case)
//
// The block is internally consistent, well-formed, and about a different product.
// Extraction took its price, availability, variants, features and URL, and every
// existing guard passed it: the shape validator sees a valid price, page
// corroboration exempts json-ld (and the cover's price IS on the page), request
// ranking does not apply, and the conflict detector needs two paths to disagree.
//
// The discriminating signal is identifiers. The page URL carries 1145507276 and
// ean 9780594205821; the block carries 1140326163 and sku 9780594120414. Nothing
// in common.

import { describe, it, expect } from 'vitest';
import { extractIdentifiers, describesSamePage, filterRequestsForPage } from './entity-match.js';

const BN_PAGE = 'https://www.barnesandnoble.com/w/nook-glowlight-4-barnes-noble/1145507276?ean=9780594205821';
const BN_COVER_ENTITY = {
  '@type': 'Product',
  name: 'NOOK GlowLight 4 and 4e Cover in Daffodil',
  sku: '9780594120414',
  offers: {
    url: 'https://www.barnesandnoble.com/w/nook-glowlight-4-and-4e-cover-in-daffodil-barnes-noble/1140326163?ean=9780594120414',
    price: '9.99',
  },
};

describe('extractIdentifiers', () => {
  it('pulls long identifiers out of the path and query', () => {
    const ids = extractIdentifiers(BN_PAGE);
    expect(ids.has('1145507276')).toBe(true);
    expect(ids.has('9780594205821')).toBe(true);
  });

  it('ignores short slug words that are not identifiers', () => {
    const ids = extractIdentifiers(BN_PAGE);
    expect(ids.has('nook')).toBe(false);
    expect(ids.has('4')).toBe(false);
    expect(ids.has('w')).toBe(false);
  });

  it('handles a URL with no identifiers at all', () => {
    expect(extractIdentifiers('https://shop.example.com/about').size).toBe(0);
  });

  it('does not throw on a non-URL', () => {
    expect(() => extractIdentifiers('not a url')).not.toThrow();
  });
});

describe('describesSamePage', () => {
  it('rejects the B&N accessory block on the e-reader page', () => {
    const r = describesSamePage(BN_COVER_ENTITY, BN_PAGE);
    if (r.ok) throw new Error('expected the accessory block to be rejected');
    expect(r.reason).toMatch(/identifier/i);
  });

  it('accepts a block whose sku matches an identifier in the page URL', () => {
    const entity = { '@type': 'Product', name: 'NOOK GlowLight 4', sku: '9780594205821' };
    expect(describesSamePage(entity, BN_PAGE).ok).toBe(true);
  });

  it('accepts a block whose offer URL points at the same product path', () => {
    const entity = {
      '@type': 'Product', name: 'NOOK GlowLight 4',
      offers: { url: 'https://www.barnesandnoble.com/w/nook-glowlight-4-barnes-noble/1145507276' },
    };
    expect(describesSamePage(entity, BN_PAGE).ok).toBe(true);
  });

  // --- Permissiveness: reject only on positive conflicting evidence ---

  it('accepts a block carrying no identifiers — absence is not evidence', () => {
    const entity = { '@type': 'Product', name: 'Some Product', offers: { price: '10.00' } };
    expect(describesSamePage(entity, BN_PAGE).ok).toBe(true);
  });

  it('accepts anything when the page URL itself has no identifiers', () => {
    const entity = { '@type': 'Product', name: 'X', sku: '9999999999' };
    expect(describesSamePage(entity, 'https://shop.example.com/product').ok).toBe(true);
  });

  it('is not confused by www or trailing-slash differences', () => {
    const entity = {
      '@type': 'Product', name: 'NOOK GlowLight 4',
      url: 'https://barnesandnoble.com/w/nook-glowlight-4-barnes-noble/1145507276/',
    };
    expect(describesSamePage(entity, BN_PAGE).ok).toBe(true);
  });

  it('accepts non-Product blocks untouched — Organization, BreadcrumbList and friends', () => {
    // These legitimately carry unrelated identifiers and are not competing to be
    // the page's product.
    for (const type of ['Organization', 'BreadcrumbList', 'WebSite', 'WebPage']) {
      expect(describesSamePage({ '@type': type, url: 'https://x.com/other/999999999' }, BN_PAGE).ok).toBe(true);
    }
  });

  it('handles null and non-object input', () => {
    expect(describesSamePage(null, BN_PAGE).ok).toBe(true);
    expect(describesSamePage('nope', BN_PAGE).ok).toBe(true);
  });
});

describe('filterRequestsForPage', () => {
  // The second channel the accessory data arrived through. Fixing the capture
  // navigation left this one untouched: sku, description and variants kept
  // coming back as the cover's, sourced from `api` / `api-ai`.
  const COVER_RESPONSE = {
    url: 'https://e9c22f-3.myshopify.com/api/2025-07/graphql.json',
    parsedJson: {
      data: { product: { handle: 'nook-cover-daffodil', variants: [{ sku: '9780594120414', price: '9.99' }], legacyId: 1140326163 } },
    },
  };
  const MAIN_RESPONSE = {
    url: 'https://www.barnesandnoble.com/api/product',
    parsedJson: { product: { ean: '9780594205821', price: 149.99 } },
  };
  const REVIEWS_RESPONSE = {
    url: 'https://api-cdn.yotpo.com/v3/storefront/reviews',
    parsedJson: { reviews: [{ score: 5, title: 'Great!', content: 'Love it' }] },
  };

  it('drops a response carrying only another product identifiers', () => {
    const kept = filterRequestsForPage([COVER_RESPONSE], BN_PAGE);
    expect(kept).toEqual([]);
  });

  it('keeps a response about the requested product', () => {
    expect(filterRequestsForPage([MAIN_RESPONSE], BN_PAGE)).toHaveLength(1);
  });

  it('keeps a response that carries no identifiers at all', () => {
    // A reviews feed has offered no evidence either way; silence is not a mismatch.
    expect(filterRequestsForPage([REVIEWS_RESPONSE], BN_PAGE)).toHaveLength(1);
  });

  it('keeps a response containing BOTH the page product and others', () => {
    // Coarse by design: whole-response granularity. Within-response scoping is a
    // different problem and this must not pretend to solve it.
    const mixed = { url: 'https://x.com/api/page', parsedJson: { main: { ean: '9780594205821' }, alsoBought: [{ sku: '9780594120414' }] } };
    expect(filterRequestsForPage([mixed], BN_PAGE)).toHaveLength(1);
  });

  it('keeps everything when the page URL has no identifiers', () => {
    expect(filterRequestsForPage([COVER_RESPONSE], 'https://shop.example.com/product')).toHaveLength(1);
  });

  it('terminates on a self-referential payload', () => {
    const cyclic: Record<string, unknown> = { id: '9999999999' };
    cyclic.self = cyclic;
    expect(() => filterRequestsForPage([{ url: 'https://x.com/a', parsedJson: cyclic }], BN_PAGE)).not.toThrow();
  });
});

describe('filterRequestsForPage — why it is NOT wired into the chain', () => {
  // Wired up, this dropped 8 of 10 Nike responses including the genuine product
  // APIs. Kept as an executable record of the failure mode so the approach is not
  // rebuilt from the same reasoning.
  const NIKE_PAGE = 'https://www.nike.com/t/air-jordan-12-retro-mens-shoes-pz28oX9z/CT8013-003';

  it('over-rejects when the API and the URL use different identifier namespaces', () => {
    // Nike's URL carries style codes; its APIs carry timestamps, site ids and
    // GTINs. Nothing overlaps, and nothing should be expected to.
    const realNikeProductApi = {
      url: 'https://api.nike.com/discover/product_details_availability/v1/marketplace/US',
      parsedJson: { products: [{ gtin: '00198729090348', styleColor: '153265-003', updatedAt: 1774411200000 }] },
    };
    const kept = filterRequestsForPage([realNikeProductApi], NIKE_PAGE);
    expect(kept, 'a genuine product API is dropped — this is the bug, not the intent').toHaveLength(0);
  });

  it('only worked on B&N by coincidence — its URL happens to carry the same EAN', () => {
    const bnPageCarriesTheEan = extractIdentifiers(BN_PAGE).has('9780594205821');
    expect(bnPageCarriesTheEan).toBe(true);
  });
});
