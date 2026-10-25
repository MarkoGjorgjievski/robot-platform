/**
 * What the Verification tab's listing bar starts with (first run 2026-10-25, D5): the listing the
 * website already has, or else the address typed in Add website when that page can be a listing,
 * so the customer does not paste it twice. Only a starting value — the customer can still change it,
 * and nothing is saved until Find products answers.
 *
 * A shop's front page (no path, or only a country/language part such as `/my/en/`) is the website
 * rather than a listing, and a product page (`/products/…`, `/p/…`, `/dp/…`) is never one.
 */
export function listingBarStart(listingUrl: string, websiteUrl: string | null | undefined): string {
  if (listingUrl.trim()) return listingUrl;
  const address = websiteUrl?.trim() ?? '';
  return address && canBeListing(address) ? address : '';
}

const PRODUCT_SEGMENT = new Set(['product', 'products', 'p', 'dp', 'item', 'items', 'ip']);
const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2})?$/i;

function canBeListing(address: string): boolean {
  let u: URL;
  try {
    u = new URL(address);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (/[{}]/.test(address)) return false; // a website's address template (`{country}`), not a page
  const segments = u.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
  if (segments.some((s) => PRODUCT_SEGMENT.has(s))) return false;
  if (u.search) return true;
  return segments.some((s) => !LOCALE_SEGMENT.test(s));
}
