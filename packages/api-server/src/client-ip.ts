// The caller's address for the rate limits (spec 2026-10-24 tenant isolation §2.4). The socket's, unless
// TRUST_PROXY=on — then the last X-Forwarded-For entry, the one the proxy in front of us wrote (the entries before it
// are whatever the client sent). "unknown" when there is no socket (an in-process request).
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

export function clientIpOf(c: Context, env: Record<string, string | undefined> = process.env): string {
  if ((env.TRUST_PROXY ?? '').trim().toLowerCase() === 'on') {
    const last = c.req.header('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address || 'unknown';
  } catch {
    return 'unknown';
  }
}
