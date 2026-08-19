export type LiveCorpusEntry = {
  label: string;
  url: string;
  pageType: 'detail' | 'listing';
  /** Field names to request. Use ['discover'] to let analyze propose. */
  fields: string[];
  /** Fields we expect to NOT be on this page — counted as "absent" in reports, not "miss". */
  knownAbsentFields?: string[];
};

/**
 * Tier 2 live-dogfood corpus.
 *
 * Chosen for STRUCTURAL diversity, not brand variety — each entry should exercise
 * a different path through the extraction chain, because that is what the reports
 * are meant to measure:
 *
 *   newegg  — JSON-LD present + rich intercepted APIs (the mechanical happy path)
 *   target  — no JSON-LD, `__NEXT_DATA__` driven (exercises the nextData walker)
 *   bn      — no JSON-LD, no nextData, API-only (forces AI-API analysis, which is
 *             exactly the condition under which the Newegg cache poisoning
 *             occurred, so it exercises the page-corroboration rule)
 *
 * Candidates verified as capturable headless on 2026-08-18. Rejected in the same
 * probe: Wayfair and Etsy (CAPTCHA), B&H Photo (Cloudflare), REI (HTTP/2 error).
 * Anti-bot, not page complexity, is the binding constraint on corpus growth — see
 * docs/ideas.md → `@robot/browser` hardening.
 *
 * IKEA was REMOVED on 2026-08-18. Its headless anti-bot now serves a category
 * page instead of the product page for the Kallax URL — the 2026-08-18 reports
 * show it discovering `category_name` / `subcategories` rather than product
 * fields, which is noise, not signal. The Tier 1 fixture
 * (`ikea-kallax-detail`) replays a captured snapshot and still guards the
 * JSON-LD variant walker, so removing it here loses no regression coverage.
 * Restore it if and when headless capture is hardened.
 */
export const liveCorpus: LiveCorpusEntry[] = [
  {
    label: 'newegg-samsung-9100-pro',
    url: 'https://www.newegg.com/samsung-2tb-9100-pro-nvme-2-0/p/N82E16820147903',
    pageType: 'detail',
    fields: ['discover'],
    knownAbsentFields: ['variants'],
  },
  {
    label: 'target-sylvox-kitchen-tv',
    url: 'https://www.target.com/p/sylvox-15-6-smart-kitchen-tv-1080p-fhd-flip-down-under-cabinet-tv-newest-google-tv-with-app-store-google-assistant-12-volt-smart-tv-for-kitchen/-/A-91311203',
    pageType: 'detail',
    fields: ['discover'],
  },
  {
    label: 'bn-nook-glowlight-4',
    url: 'https://www.barnesandnoble.com/w/nook-glowlight-4-barnes-noble/1145507276?ean=9780594205821',
    pageType: 'detail',
    fields: ['discover'],
  },

  // ─── Added 2026-08-19, reachable only because stealth is now on by default ───
  // Of eleven candidates probed, four were hard-blocked (Lowe's, Adorama, Sephora,
  // Micro Center) and three hide their product grids behind post-load rendering
  // (Home Depot, Chewy, Decathlon). Anti-bot, not page complexity, is still what
  // limits corpus growth — see docs/roadmap.md P3b.

  {
    // Was Cloudflare-blocked before stealth. US electronics, server-rendered,
    // rich JSON-LD — the closest thing to an easy case in the corpus.
    label: 'bhphoto-samsung-t7',
    url: 'https://www.bhphotovideo.com/c/product/1559839-REG/samsung_mu_pc2t0t_am_2tb_t7_portable_ssd.html',
    pageType: 'detail',
    fields: ['discover'],
    knownAbsentFields: ['variants'],
  },
  {
    // Books marketplace: MANY sellers per title, each with its own price and
    // condition. The same multi-seller shape as Newegg, on a completely different
    // stack — this is the site that tells us whether the price-disambiguation
    // problem in docs/ideas.md is a platform concern or a Newegg quirk.
    // Note: AbeBooks listings are per-copy and can sell out; if this 404s the
    // liveness check will say so, which is the intended behaviour.
    label: 'abebooks-listing',
    url: 'https://www.abebooks.co.uk/servlet/BookDetailsPL?bi=32500288053',
    pageType: 'detail',
    fields: ['discover'],
    knownAbsentFields: ['variants'],
  },
  {
    // EU fashion: GBP, EU consent regime, size variants.
    label: 'zalando-air-force-1',
    url: 'https://www.zalando.co.uk/nike-sportswear-air-force-1-07-trainers-white-ni112n022-a11.html',
    pageType: 'detail',
    fields: ['discover'],
  },
  {
    // UK electronics. Three JSON-LD blocks on one page, which exercises the
    // entity-matching added after the Barnes & Noble accessory bug.
    label: 'currys-macbook-pro-14',
    url: 'https://www.currys.co.uk/products/apple-macbook-pro-14-2025-m5-1-tb-ssd-silver-10292727.html',
    pageType: 'detail',
    fields: ['discover'],
  },
  {
    // Apparel on a bespoke stack, with colour selection in the URL itself
    // (`colorDisplayCode`) — a variant axis expressed as a query parameter rather
    // than in the page body.
    label: 'uniqlo-supima-tee',
    url: 'https://www.uniqlo.com/us/en/products/E455365-000/00?colorDisplayCode=68',
    pageType: 'detail',
    fields: ['discover'],
  },
];
