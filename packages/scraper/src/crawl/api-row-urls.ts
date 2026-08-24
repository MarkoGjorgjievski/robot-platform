// Which of an API page's row values may be treated as detail URLs — and which
// must be refused.
//
// Spec §4: "When the API returns bare ids or slugs rather than URLs: if the
// Source has a `url_template`, substitute; otherwise fall through to HTML
// pagination rather than fabricate a URL." Nothing implemented that, and the
// consequence is the 2026-08-21 failure class with a new trigger — a walk that
// plans confident-looking URLs nobody ever fetched, gains > 0, and writes the
// config to the cross-customer domain cache in silence.
//
// Note on the missing half of §4: `Source.url_template` is the LISTING input
// template (`buildInputUrls` expands InputSet rows through it); it is not a
// detail-URL template, so there is nothing here to substitute with. The
// fall-through branch is the one that applies, and it is the one implemented.

import { getPath } from './api-identifiers.js';

/**
 * The shape page 1's own detail URLs demonstrate: the origins they live on, and
 * the directory prefix every one of them shares.
 *
 * WHY BOTH, and why "consistent" means exactly this:
 *
 * - **Origin** catches the cross-origin API (`api.site.com` serving
 *   `www.site.com`). It is not sufficient on its own: a bare slug resolved
 *   against the listing page lands on the RIGHT origin and is still fabricated.
 *
 * - **Common directory prefix** catches the bare slug, and also the API that
 *   answers with its own internal path (`/api/v2/products/123`) rather than the
 *   site's. It is deliberately the LONGEST prefix page 1 itself agrees on, not a
 *   fixed depth: a listing whose page-1 URLs sit in `/books/` demands `/books/`,
 *   while a genuinely mixed listing (`/books/x`, `/dvd/y`) degenerates to `/`
 *   and the check becomes a no-op. We demand only as much consistency as page 1
 *   has actually demonstrated, so a heterogeneous listing is never refused for
 *   heterogeneity it showed us up front.
 *
 * The cost of a false refusal is bounded and visible: the walk stops, page 1's
 * items are kept, a warning names the offending value, and nothing is cached.
 * The cost of a false acceptance is a fabricated URL replayed free across
 * customers forever. §4 chose the first, and so does this.
 */
export type Page1Shape = { origins: Set<string>; pathPrefix: string };

/** The directory part of a pathname: everything up to and including the last '/'. */
function directoryOf(pathname: string): string {
  return pathname.slice(0, pathname.lastIndexOf('/') + 1);
}

/** The longest leading run of path segments two directories share. */
function commonDirectory(a: string, b: string): string {
  const as = a.split('/');
  const bs = b.split('/');
  const out: string[] = [];
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    if (as[i] !== bs[i]) break;
    out.push(as[i]!);
  }
  const joined = out.join('/');
  return joined.endsWith('/') ? joined : `${joined}/`;
}

/**
 * What page 1 demonstrated, or null when it demonstrated nothing usable.
 *
 * `page1Urls` are the raw `detail_url` values row extraction produced, so they
 * may be relative — resolved against `baseUrl` (the listing page) exactly as
 * `enumerateDetailUrls` resolves them.
 */
export function page1Shape(page1Urls: string[], baseUrl: string): Page1Shape | null {
  const origins = new Set<string>();
  let prefix: string | null = null;
  for (const raw of page1Urls) {
    let url: URL;
    try {
      url = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    origins.add(url.origin);
    const dir = directoryOf(url.pathname);
    prefix = prefix === null ? dir : commonDirectory(prefix, dir);
  }
  if (origins.size === 0 || prefix === null) return null;
  return { origins, pathPrefix: prefix };
}

/**
 * Is this raw row value shaped like a URL at all?
 *
 * A bare id (`12345`) or slug (`python-programming`) carries no path structure,
 * so resolving it against anything invents a URL rather than reading one. A
 * value containing a '/' — `/p/123`, `p/123`, `https://…/p/123` — is a genuine
 * path or absolute URL and resolution is reading, not inventing.
 */
function isUrlShaped(raw: string): boolean {
  if (raw.includes('/')) return true;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export type RowUrls = {
  /** Values that are safe to plan, still in their raw form for `absorb` to resolve. */
  usable: string[];
  /** The first value that was refused, for the warning. Null when nothing was refused. */
  refused: string | null;
};

/**
 * The raw strings at `itemsPath[].urlPath` that may be planned as detail URLs.
 *
 * Returned RAW rather than resolved: `enumerateDetailUrls` already resolves
 * against the page URL, dedupes and drops self-links, and having two places
 * that resolve is how the two would drift apart.
 */
export function rowUrls(
  json: unknown,
  itemsPath: string,
  urlPath: string,
  baseUrl: string,
  shape: Page1Shape | null,
): RowUrls {
  const items = getPath(json, itemsPath);
  if (!Array.isArray(items)) return { usable: [], refused: null };
  const usable: string[] = [];
  let refused: string | null = null;
  for (const item of items) {
    const raw = getPath(item, urlPath);
    if (typeof raw !== 'string' || raw.length === 0) continue;
    if (shape === null || !isUrlShaped(raw) || !fitsShape(raw, baseUrl, shape)) {
      refused ??= raw;
      continue;
    }
    usable.push(raw);
  }
  return { usable, refused };
}

function fitsShape(raw: string, baseUrl: string, shape: Page1Shape): boolean {
  let url: URL;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return false;
  }
  if (!shape.origins.has(url.origin)) return false;
  return url.pathname.startsWith(shape.pathPrefix);
}
