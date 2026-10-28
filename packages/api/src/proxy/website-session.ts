// packages/api/src/proxy/website-session.ts
// A website's browser session (spec 2026-10-24 proxy §2.2): every page load for a website opens its browser through
// this, with the website's proxy, locale and time zone read as the session opens. Reachability and the listing check
// come here too when they are given a website (the Verification and Extract tabs); only an address with no website
// yet (Add website) calls `withBrowserSession` directly and goes direct (§3.4).
import type { IBrowser } from '@robot/browser';
import { db } from '@robot/db';
import { withBrowserSession } from '../browser-session.js';
import { browserProfileForSource, type RouteOptions } from './browser-profile.js';

export type WebsiteSession = <T>(fn: (browser: IBrowser) => Promise<T>) => Promise<T>;

/** `session`: the one to open (tests inject a fake one; the drift check and proof-page capture pass theirs through).
 *  `opts`: a try by the fallback route and the country it uses (spec 2026-10-28 turned away §3.3). */
export function forWebsite(sourceId: string, session: typeof withBrowserSession = withBrowserSession, opts: RouteOptions = {}): WebsiteSession {
  return async <T,>(fn: (browser: IBrowser) => Promise<T>): Promise<T> => {
    // An address that cannot be used throws the proxy CaptureError here, before any browser opens (spec §3.1).
    const profile = await browserProfileForSource(db, sourceId, opts);
    return session(fn, { profile });
  };
}
