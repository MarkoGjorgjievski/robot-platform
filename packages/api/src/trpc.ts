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
export const createCallerFactory = t.createCallerFactory;

/**
 * Is this email one of the operators (ops mode, 2026-10-06)? `OPS_EMAILS` is a
 * comma-separated allowlist in the environment; each side is trimmed and
 * compared case-insensitively, so " A@x.com ,b@y.com" matches `a@x.com`. An
 * empty or unset list means nobody is an operator.
 */
export function isOperatorEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = (process.env.OPS_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.trim().toLowerCase());
}

/** Every procedure's context gains `isOperator`, derived from the session the
 * context builder already loaded — so no caller has to pass it in. */
const withOperatorFlag = t.middleware(({ ctx, next }) =>
  next({ ctx: { ...ctx, isOperator: isOperatorEmail(ctx.session?.user.email) } })
);

export const publicProcedure = t.procedure.use(withOperatorFlag);

/** A procedure that needs a signed-in user; `ctx.session` is non-null inside. */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in first' });
  return next({ ctx: { ...ctx, session: ctx.session } });
});

/** A procedure for operators only (ops mode, 2026-10-06): FORBIDDEN unless
 * `ctx.isOperator`. Ops stays read-only and never changes a customer's data. */
export const opsProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.isOperator) throw new TRPCError({ code: 'FORBIDDEN', message: 'Operators only' });
  return next({ ctx });
});

/** Guard a procedure by the caller's role in the current org. */
export function requireRole(session: SessionInfo, roles: MembershipRole[]): void {
  if (!roles.includes(session.role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Your role in this organisation does not allow that' });
  }
}
