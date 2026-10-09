// The registrable domain of a host, so a capture that ends on www2.hm.com or
// uk.x.com is still the site that was asked for. A copy of @robot/scraper's
// extractRootDomain (domain-utils.ts): @robot/scraper depends on this package,
// so the dependency cannot run the other way.

const COMPOUND_TLDS = ['co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in',
  'com.au', 'com.br', 'com.mx', 'com.tr', 'com.sg', 'com.ar',
  'org.uk', 'net.au', 'ac.uk', 'gov.uk'];

export function rootDomain(hostname: string): string {
  const clean = hostname.toLowerCase().replace(/^www\./, '');
  // An IP address has no registrable part; it is its own site.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean) || clean.includes(':')) return clean;
  const parts = clean.split('.');
  if (COMPOUND_TLDS.includes(parts.slice(-2).join('.')) && parts.length >= 3) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}
