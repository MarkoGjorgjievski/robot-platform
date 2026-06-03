// Third-party noise filter for intercepted requests.
//
// Some non-product JSON responses ship with product-shaped keys (e.g. OneTrust's
// otFlat.json publishes {"name":"otFlat", "html":"...", "css":"..."}). When an
// AI API analysis or cached dot-notation path picks "name" against such a
// response, the cache learns to return literal strings like "otFlat" as the
// product name forever. The cleanest defense is to drop these responses before
// they reach ranking or cache replay.

const NOISE_HOSTS = [
  // Consent / privacy management
  'cookielaw.org',
  'onetrust.com',
  'cookiebot.com',
  'trustarc.com',
  'didomi.io',
  'usercentrics.eu',
  // Analytics / tag management
  'googletagmanager.com',
  'google-analytics.com',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'heap.io',
  'scorecardresearch.com',
  // A/B test platforms
  'optimizely.com',
  'launchdarkly.com',
  'split.io',
  // Session replay
  'hotjar.com',
  'fullstory.com',
  'mouseflow.com',
  'logrocket.com',
];

const NOISE_PATH_PATTERNS = [
  // First-party hosted A/B-test asset blobs (confirmed at IKEA)
  /\/optimizely\//,
  // OneTrust template filenames that may be re-hosted on first-party CDNs
  /\/otFlat\.json$/i,
  /\/otPcPanel\.json$/i,
];

/** True if the URL is known third-party noise (consent, analytics, A/B-test
 * blobs) that should never enter ranking or cache replay. */
export function isThirdPartyNoise(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  for (const noise of NOISE_HOSTS) {
    if (host === noise || host.endsWith('.' + noise)) return true;
  }
  for (const re of NOISE_PATH_PATTERNS) {
    if (re.test(parsed.pathname)) return true;
  }
  return false;
}
