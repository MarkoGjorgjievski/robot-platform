// Guards `/captures/*` (security fix, 2026-10-07): a capture screenshot or
// proof-page tile is customer data — a page a competitor would pay to see
// before a product launch — so it must be gated exactly like the `/export/*`
// routes (export.ts): the `robot_session` cookie is loaded the same way, no
// session is 401, and a file belonging to another org (or none at all) is
// 404 — the two indistinguishable on purpose. This file only decides
// allow/deny; `serveStatic`, mounted after it on the same path in app.ts,
// still does the actual file read and content-type/etag handling.
//
// Every capture file `persistScreenshot` has ever written is reachable
// through `orgIdForCaptureFile` (org-for-export.ts) — a verification
// screenshot via `captures.screenshot_path`, a proof-page tile (including
// one past `tiles[0]`) via `captures.metadata.tiles`. An id this gate can't
// resolve 404s rather than falling through to the filesystem.

import type { MiddlewareHandler } from 'hono';
import type { SessionInfo } from '@robot/api/auth';
import { sessionTokenFrom } from '../session-cookie.js';

export type CaptureGateDeps = {
  loadSession: (token: string) => Promise<SessionInfo | null>;
  orgIdForCaptureFile: (filename: string) => Promise<string | null>;
};

/** Anything but a bare filename is rejected before the filesystem (or even
 *  the database) ever sees it — a literal `/`, `\` or `..` segment, or one
 *  that only appears after percent-decoding (`%2e%2e`, `%2f`, `%5c`). An
 *  unparsable percent-escape is rejected the same way. */
function unsafeFilename(raw: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return true;
  }
  return decoded.length === 0 || /[\\/]|\.\./.test(decoded);
}

export function createCaptureGate(deps: CaptureGateDeps): MiddlewareHandler {
  return async (c, next) => {
    const file = c.req.path.slice('/captures/'.length);
    if (unsafeFilename(file)) return c.json({ error: 'Not found' }, 400);

    const session = await deps.loadSession(sessionTokenFrom(c.req.header('cookie')));
    if (!session) return c.json({ error: 'Sign in first' }, 401);

    const orgId = await deps.orgIdForCaptureFile(decodeURIComponent(file));
    if (orgId !== session.org.id) return c.json({ error: 'Not found' }, 404);

    await next();
  };
}
