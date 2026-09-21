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
};

/**
 * `auth.me`, asked on the server so the very first paint already knows who is
 * signed in (and therefore which theme to render) with no client round-trip.
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
    const res = await fetch(`${API_URL}/trpc/auth.me`, { headers: { cookie } });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: { data?: unknown } };
    if (!body.result || body.result.data === undefined) return null;
    return superjson.deserialize(body.result.data as Parameters<typeof superjson.deserialize>[0]) as Session;
  } catch {
    // The api-server being down must not blank the app: treat it as signed out.
    return null;
  }
});
