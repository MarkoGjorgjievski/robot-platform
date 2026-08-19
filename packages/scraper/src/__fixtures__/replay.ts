// Tier 1 fixture replay — now driving the PRODUCTION extraction chain.
//
// This file used to contain a parallel reimplementation of the chain: its own
// tryAssign, its own step ordering, its own type inference. That made the
// "deterministic gate" green against a lookalike rather than against the code
// that ships. Two fixes landed in the real chain on 2026-08-18 — page
// corroboration and array-field collection — and neither was exercised by a
// single fixture, because the fixture harness never ran that code.
//
// It now calls `runExtraction` with offline collaborators:
//
//   capture      — synthesised from the fixture instead of taken live
//   agent: null  — every AI step is skipped, so replay stays free and
//                  deterministic. This is the honest limit of Tier 1: the AI
//                  branches remain uncovered here and need a Tier 2 dogfood.
//   cache        — served from the fixture's fieldPaths; saves are dropped so a
//                  replay cannot write to the database
//   browser      — a fixture-backed adapter whose `evaluate` runs the generated
//                  script against the captured HTML via setContent, so cached
//                  XPaths execute in real Chromium with no network

import { PlaywrightBrowser } from '@robot/browser';
import type { CaptureOptions, CrawlOptions, CrawlPage, IBrowser, PageCapture } from '@robot/browser';
import { runExtraction } from '../extraction-orchestrator.js';
import type { DomainCache } from '../domain-cache.js';
import type { Fixture } from './types.js';

export type ReplayResult = {
  resolved: Record<string, unknown>;
  sources: Record<string, string>;
};

/**
 * Type used for shape-validation on replay — inferred from the golden expected
 * value so that e.g. cached XPath strings like "4.15" are normalised to number
 * 4.15 the same way prod does (via validateFieldShape with the right type).
 */
function inferType(expected: unknown): string {
  if (Array.isArray(expected) && expected.length > 0
      && typeof expected[0] === 'object' && expected[0] !== null
      && !Array.isArray(expected[0])) {
    return 'variant_array';
  }
  if (typeof expected === 'number') return 'number';
  if (typeof expected === 'boolean') return 'boolean';
  if (Array.isArray(expected)) return 'array';
  return 'string';
}

/**
 * Serves the fixture's captured HTML to any `evaluate` the chain performs.
 *
 * The production `evaluate` navigates to a URL; here every script runs against
 * the frozen HTML through `setContentEvaluate`, which does no network I/O. The
 * scripts themselves are the real generated ones, executed by real Chromium.
 */
class FixtureBrowser implements IBrowser {
  constructor(private readonly html: string, private readonly inner: PlaywrightBrowser) {}

  async launch(): Promise<void> {
    await this.inner.launch({ headless: true });
  }

  async capture(): Promise<PageCapture> {
    throw new Error('FixtureBrowser cannot capture — the fixture supplies the capture');
  }

  async evaluate<T = unknown>(_url: string, script: string, _options?: CaptureOptions): Promise<T> {
    return this.inner.setContentEvaluate<T>(this.html, script);
  }

  async setContentEvaluate<T = unknown>(html: string, script: string): Promise<T> {
    return this.inner.setContentEvaluate<T>(html, script);
  }

  async close(): Promise<void> {
    await this.inner.close();
  }

  // Fixture replay is offline and single-page: there is no live pagination to
  // crawl, and this method is never invoked during replay. An empty generator
  // satisfies IBrowser without pretending crawling is something a frozen
  // fixture can do.
  async *crawl(_startUrl: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {
    return;
  }
}

export async function runFixtureReplay(fixture: Fixture): Promise<ReplayResult> {
  const fieldNames = Object.keys(fixture.expected);

  const capture: PageCapture = {
    url: fixture.url,
    html: fixture.html,
    markdown: '',
    screenshot: Buffer.alloc(0),
    screenshotTiles: [],
    title: '',
    timestamp: 0,
    structuredData: fixture.structuredData,
    interceptedRequests: fixture.interceptedRequests,
  };

  // totalRuns must be > 0 or the chain skips its cached-path steps entirely,
  // which are the steps a fixture exists to exercise.
  const cache: DomainCache = {
    domain: fixture.domain,
    pageType: fixture.pageType,
    fieldPaths: fixture.fieldPaths,
    totalRuns: 1,
    successfulRuns: 1,
    successRate: 100,
    rowSelector: null,
  } as DomainCache;

  const browser = new FixtureBrowser(fixture.html, new PlaywrightBrowser());
  await browser.launch();

  try {
    const outcome = await runExtraction(
      {
        url: fixture.url,
        pageType: fixture.pageType,
        fields: fieldNames.map((name) => ({
          name,
          type: inferType(fixture.expected[name]),
          description: '',
          tier: 'requested' as const,
        })),
      },
      {
        browser,
        agent: null,
        lookupCache: async () => cache,
        saveCache: async () => { /* a replay must never write to the database */ },
        acquireLock: async () => () => { /* no cross-process contention offline */ },
        capture,
      },
    );

    const resolved: Record<string, unknown> = {};
    for (const row of [...outcome.fieldsByTier.requested, ...outcome.fieldsByTier.discovered]) {
      if (row.value !== null && row.value !== undefined) resolved[row.name] = row.value;
    }
    return { resolved, sources: outcome.sources };
  } finally {
    await browser.close();
  }
}
