// packages/api/src/verify/check-schedule.ts
// When a website's proof pages are next read by the scheduled check (spec
// 2026-10-21 §3.3). Kept apart from website-checks.ts so the Verify and the
// check can move `next_check_at` without importing the scheduler.
export const WEBSITE_CHECK_DAYS_DEFAULT = 3;

export function websiteCheckDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.WEBSITE_CHECK_DAYS);
  return Number.isFinite(n) && n > 0 ? n : WEBSITE_CHECK_DAYS_DEFAULT;
}

export function nextCheckAt(from: Date = new Date(), days: number = websiteCheckDays()): Date {
  return new Date(from.getTime() + days * 86_400_000);
}
