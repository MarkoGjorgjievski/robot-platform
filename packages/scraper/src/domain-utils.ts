/**
 * Extract the brand name (root domain without TLD) from a full domain.
 *
 * Examples:
 *   amazon.com → amazon
 *   amazon.co.uk → amazon
 *   www.amazon.nl → amazon
 *   groceries.morrisons.com → morrisons
 *   news.ycombinator.com → ycombinator
 *   target.com → target
 */
export function extractBrand(domain: string): string {
  const clean = domain.replace(/^www\./, '');
  const parts = clean.split('.');

  // Handle known compound TLDs
  const compoundTlds = ['co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in',
    'com.au', 'com.br', 'com.mx', 'com.tr', 'com.sg', 'com.ar',
    'org.uk', 'net.au', 'ac.uk', 'gov.uk'];

  const suffix = parts.slice(-2).join('.');
  if (compoundTlds.includes(suffix) && parts.length >= 3) {
    // e.g. amazon.co.uk → parts = [amazon, co, uk]
    return parts[parts.length - 3];
  }

  // Standard: domain.tld or subdomain.domain.tld
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }

  return clean;
}

/**
 * Extract the root domain (brand + TLD) from a full domain.
 *
 * Examples:
 *   www.amazon.com → amazon.com
 *   amazon.co.uk → amazon.co.uk
 *   groceries.morrisons.com → morrisons.com
 *   news.ycombinator.com → ycombinator.com
 */
export function extractRootDomain(domain: string): string {
  const clean = domain.replace(/^www\./, '');
  const parts = clean.split('.');

  const compoundTlds = ['co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in',
    'com.au', 'com.br', 'com.mx', 'com.tr', 'com.sg', 'com.ar',
    'org.uk', 'net.au', 'ac.uk', 'gov.uk'];

  const suffix = parts.slice(-2).join('.');
  if (compoundTlds.includes(suffix) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

/**
 * Check if two domains are related (same brand, different TLD/subdomain).
 */
export function areDomainsRelated(a: string, b: string): boolean {
  return extractBrand(a) === extractBrand(b);
}

/**
 * Check if domain is a subdomain (not just www).
 * groceries.morrisons.com → true
 * www.morrisons.com → false
 * morrisons.com → false
 */
export function isSubdomain(domain: string): boolean {
  const clean = domain.replace(/^www\./, '');
  const root = extractRootDomain(domain);
  return clean !== root;
}

/**
 * Get the subdomain prefix if any.
 * groceries.morrisons.com → "groceries"
 * www.amazon.com → null
 * amazon.com → null
 */
export function getSubdomainPrefix(domain: string): string | null {
  const clean = domain.replace(/^www\./, '');
  const root = extractRootDomain(domain);
  if (clean === root) return null;
  return clean.replace('.' + root, '');
}
