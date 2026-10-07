// Shared between the tRPC adapter and the export routes (final review I1):
// both read the same `robot_session` cookie off the raw `cookie` header, so
// a download link and a tRPC call agree on who is signed in.
import { SESSION_COOKIE } from '@robot/api/auth';

/** `getCookie` from `hono/cookie` needs a Hono `Context`, which both callers
 * have — but a tiny regex is simpler than pulling in the helper for one cookie. */
export function sessionTokenFrom(cookieHeader: string | undefined): string {
  return new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookieHeader ?? '')?.[1] ?? '';
}
