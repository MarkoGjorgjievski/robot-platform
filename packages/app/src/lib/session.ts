import { createServerFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';
import superjson from 'superjson';
import { API_URL } from './trpc';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatarColour: string;
  theme: 'dark' | 'light' | 'system';
};

export type SessionOrg = {
  id: string;
  slug: string;
  name: string;
  personal: boolean;
  role: 'owner' | 'admin' | 'member';
};

export type Session = {
  user: SessionUser;
  orgs: SessionOrg[];
  currentOrg: SessionOrg;
  /** Ops mode (2026-10-06): the session user's email is on `OPS_EMAILS`. */
  isOperator: boolean;
  /**
   * Staff access (2026-10-07): set while an operator works inside a customer's
   * organisation — `currentOrg` is then that customer org (role 'member') and
   * `orgs` is still the operator's own memberships.
   */
  staff: { orgId: string; orgName: string; enteredAt: Date } | null;
  /** A staff session that has run past 8 hours and not been left yet. */
  staffExpired: { orgId: string; orgName: string } | null;
};

/** Unwraps a tRPC-over-HTTP response's superjson payload, or `undefined` when
 * the call failed or answered with nothing (e.g. `auth.me`'s UNAUTHORIZED). */
async function trpcResult<T>(res: Response): Promise<T | undefined> {
  if (!res.ok) return undefined;
  const body = (await res.json()) as { result?: { data?: unknown } };
  if (!body.result || body.result.data === undefined) return undefined;
  return superjson.deserialize(body.result.data as Parameters<typeof superjson.deserialize>[0]) as T;
}

/**
 * `auth.me` and `ops.me`, asked on the server so the very first paint already
 * knows who is signed in (and therefore which theme and which shell — ops or
 * customer — to render) with no client round-trip.
 *
 * The browser's cookie is forwarded verbatim: the app is on :3000 and the
 * api-server on :4000, so the server render has no cookie jar of its own —
 * the incoming request's `Cookie` header is the only session evidence there is.
 *
 * A signed-out visitor is `null`, not an error: `auth.me` is a protected
 * procedure and answers UNAUTHORIZED, which is the normal case here.
 */
export const getSession = createServerFn().handler(async (): Promise<Session | null> => {
  const cookie = getRequestHeader('cookie');
  if (!cookie) return null;

  try {
    const [me, ops] = await Promise.all([
      fetch(`${API_URL}/trpc/auth.me`, { headers: { cookie } }).then((r) => trpcResult<Omit<Session, 'isOperator'>>(r)),
      fetch(`${API_URL}/trpc/ops.me`, { headers: { cookie } }).then((r) => trpcResult<{ isOperator: boolean }>(r)),
    ]);
    if (!me) return null;
    return { ...me, isOperator: ops?.isOperator ?? false };
  } catch {
    // The api-server being down must not blank the app: treat it as signed out.
    return null;
  }
});
