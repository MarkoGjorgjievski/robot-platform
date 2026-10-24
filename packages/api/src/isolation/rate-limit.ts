// packages/api/src/isolation/rate-limit.ts
// Rate limits (spec 2026-10-24 tenant isolation §2.4): one fixed-window counter per api process, applied to every
// procedure by one middleware (trpc.ts). Groups: sign-in (per email and per client address), heavy and network work
// (per org; staff on their own key), everything else (per session). One limiter per process: several servers would
// need a shared store (spec §2.4, Open). RATE_LIMITS=off turns it off (the test configs do).
import { TRPCError } from '@trpc/server';

export const RATE_LIMITED_MESSAGE = 'Too many requests. Wait a minute and try again.';
export const WINDOW_MS = 60_000;
/** The most windows one limiter holds. Ended windows are pruned once a window; past this, the oldest are dropped,
 *  so a flood of distinct keys (addresses, emails) can never grow the process's memory without bound. */
export const MAX_KEYS = 100_000;

export type RateLimits = { signInEmail: number; signInIp: number; heavy: number; network: number; session: number };
export const DEFAULT_LIMITS: RateLimits = { signInEmail: 10, signInIp: 30, heavy: 30, network: 60, session: 1200 };

export const HEAVY_PROCEDURES = [
  'sources.verify', 'sources.confirm', 'sources.captureProofPage', 'crawl.plan', 'crawl.probeAndSample', 'crawl.execute',
  'crawl.backfill', 'sources.detectVariants', 'sources.transferMarks',
  // Not in the spec's list (final review I1): a manual drift check enqueues a drift-check job in the background lane.
  'sources.checkDrift',
  // Each sends the member an email (final review M5): an admin toggling a role cannot flood one inbox.
  'orgs.members.setRole', 'orgs.members.remove',
] as const;
export const NETWORK_PROCEDURES = ['sources.reachability', 'sources.checkListingPage', 'sources.variantLinksNear', 'sources.variantList'] as const;

export type RateGroup = 'sign-in' | 'heavy' | 'network' | 'session';
const heavy = new Set<string>(HEAVY_PROCEDURES);
const network = new Set<string>(NETWORK_PROCEDURES);

export function groupOf(path: string): RateGroup {
  if (path === 'auth.signIn') return 'sign-in';
  if (heavy.has(path)) return 'heavy';
  if (network.has(path)) return 'network';
  return 'session';
}

export type RateKey = { key: string; limit: number };
export type RateCaller = { session: { token: string; user: { id: string }; org: { id: string }; staff: unknown } | null; clientIp?: string };

/** The keys one call counts against. The sign-in email is read from the raw input, trimmed and lower-cased as the
 *  input check does, so an invalid attempt counts too. A staff session counts heavy and network work on its own key,
 *  never the customer org's. */
export function rateKeys(path: string, who: RateCaller, rawInput: unknown, limits: RateLimits = DEFAULT_LIMITS): RateKey[] {
  const ip = who.clientIp?.trim() || 'unknown';
  const group = groupOf(path);
  if (group === 'sign-in') {
    const raw = rawInput && typeof rawInput === 'object' ? (rawInput as { email?: unknown }).email : undefined;
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return [...(email ? [{ key: `sign-in:email:${email}`, limit: limits.signInEmail }] : []), { key: `sign-in:ip:${ip}`, limit: limits.signInIp }];
  }
  const s = who.session;
  if (group === 'heavy' || group === 'network') {
    const actor = !s ? `ip:${ip}` : s.staff ? `staff:${s.user.id}` : `org:${s.org.id}`;
    return [{ key: `${group}:${actor}`, limit: limits[group] }];
  }
  return [{ key: s ? `session:${s.token}` : `session:ip:${ip}`, limit: limits.session }];
}

/** Fixed windows in a Map, pruned at most once a window and capped at `maxKeys`. The Map is kept in window-start
 *  order (a new window is deleted and re-inserted), so the cap drops the oldest windows first. `take` is all or
 *  nothing: a refused call counts nowhere. */
export class RateLimiter {
  readonly limits: RateLimits;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly clock: () => number;
  private readonly windows = new Map<string, { start: number; count: number; refusalLogged?: boolean }>();
  private lastPrune: number;

  constructor(opts: { limits?: RateLimits; windowMs?: number; maxKeys?: number; now?: () => number } = {}) {
    this.limits = opts.limits ?? DEFAULT_LIMITS;
    this.windowMs = opts.windowMs ?? WINDOW_MS;
    this.maxKeys = Math.max(1, opts.maxKeys ?? MAX_KEYS);
    this.clock = opts.now ?? Date.now;
    this.lastPrune = this.clock();
  }

  take(keys: RateKey[]): boolean {
    const now = this.clock();
    if (now - this.lastPrune >= this.windowMs) this.prune();
    const live = keys.map((k) => {
      const w = this.windows.get(k.key);
      return w && now - w.start < this.windowMs ? w : undefined;
    });
    if (keys.some((k, i) => (live[i]?.count ?? 0) >= k.limit)) return false;
    const fresh = keys.filter((_, i) => !live[i]);
    if (fresh.length) this.makeRoom(fresh.length, new Set(keys.map((k) => k.key)));
    keys.forEach((k, i) => {
      const w = live[i];
      if (w) w.count++;
      else {
        this.windows.delete(k.key); // an ended window: re-inserted at the end, so the Map stays in start order
        this.windows.set(k.key, { start: now, count: 1 });
      }
    });
    return true;
  }

  /** Room for `n` new windows under the cap. The Map is in start order, so dropping from its front drops ended windows
   *  first, then the oldest live ones — never this call's keys — at a cost of the windows dropped, not of the Map. */
  private makeRoom(n: number, keep: Set<string>): void {
    if (this.windows.size + n <= this.maxKeys) return;
    for (const key of this.windows.keys()) {
      if (this.windows.size + n <= this.maxKeys) break;
      if (!keep.has(key)) this.windows.delete(key);
    }
  }

  /** After a refused `take`: true when a full key among `keys` is refused for the first time in its window, so the
   *  caller logs one line per key per window, never one per refused call. */
  firstRefusal(keys: RateKey[]): boolean {
    const now = this.clock();
    let first = false;
    for (const k of keys) {
      const w = this.windows.get(k.key);
      if (!w || now - w.start >= this.windowMs || w.count < k.limit || w.refusalLogged) continue;
      w.refusalLogged = true;
      first = true;
    }
    return first;
  }

  prune(): void {
    const now = this.clock();
    for (const [key, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(key);
    this.lastPrune = now;
  }

  get size(): number {
    return this.windows.size;
  }
}

let limiter = new RateLimiter();

/** Swaps the process's limiter and returns the one it replaced (tests inject their limits this way). */
export function useRateLimiter(next: RateLimiter): RateLimiter {
  const previous = limiter;
  limiter = next;
  return previous;
}

export function rateLimitsOn(env: Record<string, string | undefined> = process.env): boolean {
  return (env.RATE_LIMITS ?? '').trim().toLowerCase() !== 'off';
}

/** The middleware's body: counts the call, or refuses it with the customer sentence. One log line per refused key per
 *  window (a flood writes one line, not one per call); it names the procedure and its group, never the email or the
 *  address. */
export async function enforceRateLimit(path: string, who: RateCaller, getRawInput: () => Promise<unknown>): Promise<void> {
  if (!rateLimitsOn()) return;
  const raw = groupOf(path) === 'sign-in' ? await getRawInput().catch(() => undefined) : undefined;
  const keys = rateKeys(path, who, raw, limiter.limits);
  if (limiter.take(keys)) return;
  if (limiter.firstRefusal(keys)) console.warn(`[rate-limit] refused ${path} (${groupOf(path)})`);
  throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: RATE_LIMITED_MESSAGE });
}
