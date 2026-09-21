import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { Database, MembershipRole, UserTheme } from '@robot/db';

export type SessionInfo = {
  token: string;
  user: { id: string; email: string; name: string; avatarColour: string; theme: UserTheme };
  org: { id: string; slug: string; name: string; personal: boolean };
  role: MembershipRole;
};

/** `setCookie`/`clearCookie` are provided by the HTTP host (api-server); a test caller may omit them. */
export type Context = {
  db: Database;
  session: SessionInfo | null;
  setCookie?: (name: string, value: string, opts: { maxAge: number }) => void;
  clearCookie?: (name: string) => void;
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

/** A procedure that needs a signed-in user; `ctx.session` is non-null inside. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in first' });
  return next({ ctx: { ...ctx, session: ctx.session } });
});

/** Guard a procedure by the caller's role in the current org. */
export function requireRole(session: SessionInfo, roles: MembershipRole[]): void {
  if (!roles.includes(session.role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Your role in this organisation does not allow that' });
  }
}
