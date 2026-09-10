import { z } from 'zod';

/**
 * `z.string().url()` alone accepts any scheme WHATWG's URL parser
 * recognizes — `file://`, `javascript:`, `data:`, ... — any of which
 * `findProductPages` would happily hand to `withBrowserSession` for
 * `browser.capture()` to navigate to. Shared by every URL field a browser
 * might visit: the schema wizard's three verification URLs, its optional
 * listing URL, and `findProductPages`'s own `listingUrl` input.
 */
export const httpUrl = z.string().url().refine((u) => {
  // `.url()` above is a non-fatal check in zod — a malformed string (one that
  // already fails `.url()`) still reaches this refine, and `new URL()` on it
  // throws rather than returning a comparable `.protocol`. Guarded so that
  // case surfaces as `.url()`'s own "Invalid url" issue, not an unhandled
  // TypeError escaping the whole parse.
  try {
    return /^https?:$/.test(new URL(u).protocol);
  } catch {
    return false;
  }
}, {
  message: 'Only http(s) URLs are allowed',
});
