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
];
