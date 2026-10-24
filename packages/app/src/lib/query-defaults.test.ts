import { describe, expect, it } from 'vitest';
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUERY_DEFAULTS } from './query-defaults';

// Final review M8 (spec 2026-10-24 tenant isolation §2.4): a call refused over the rate limits is never sent again by
// React Query on its own — a retry would only add to the flood. Nothing in the app retries at all.
const limited = () => Object.assign(new Error('Too many requests. Wait a minute and try again.'), { data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 } });

async function queryCalls(client: QueryClient): Promise<number> {
  let calls = 0;
  const observer = new QueryObserver(client, { queryKey: ['limited'], queryFn: async () => { calls++; throw limited(); } });
  await new Promise<void>((resolve) => {
    const off = observer.subscribe((r) => { if (r.status === 'error') { off(); resolve(); } });
  });
  return calls;
}

describe('the query client defaults', () => {
  // React Query's own default is 3 retries in a browser and none on a server (this test runs in node), so the defaults
  // must say `false` themselves, for queries and mutations both.
  it('say never retry, for queries and mutations', () => {
    expect(QUERY_DEFAULTS.queries?.retry).toBe(false);
    expect(QUERY_DEFAULTS.mutations?.retry).toBe(false);
  });

  it('a rate-limited query is called once, never retried', async () => {
    expect(await queryCalls(new QueryClient({ defaultOptions: QUERY_DEFAULTS }))).toBe(1);
  });

  it("(the test can see a retry: the browser's default of 3 retries calls it four times)", async () => {
    expect(await queryCalls(new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } }))).toBe(4);
  });

  it('a rate-limited mutation is called once, never retried', async () => {
    const client = new QueryClient({ defaultOptions: QUERY_DEFAULTS });
    let calls = 0;
    const observer = new MutationObserver(client, { mutationFn: async () => { calls++; throw limited(); } });
    await expect(observer.mutate()).rejects.toThrow('Too many requests');
    expect(calls).toBe(1);
  });

  it('no screen turns retries back on', () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
    });
    const offenders = files(fileURLToPath(new URL('..', import.meta.url))).filter((f) => /\bretry:(?!\s*false\b)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
