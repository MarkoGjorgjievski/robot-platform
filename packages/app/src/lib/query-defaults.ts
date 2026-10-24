// The app's React Query defaults. Pure.
// Nothing retries on its own (final review M8, spec 2026-10-24 tenant isolation §2.4): a call refused over the rate
// limits (TOO_MANY_REQUESTS) sent again would only add to the flood, and a screen shows its own error line or the
// rate-limit sentence instead. Polling queries come back on their own interval.
import type { DefaultOptions } from '@tanstack/react-query';

export const QUERY_DEFAULTS: DefaultOptions = {
  queries: { staleTime: 30_000, retry: false },
  mutations: { retry: false },
};
