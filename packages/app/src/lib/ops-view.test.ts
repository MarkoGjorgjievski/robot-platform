import { describe, it, expect } from 'vitest';
import {
  ONE_SOURCE_WARNING,
  OPS_REASONS,
  backupsSummary,
  decodeOpsOverviewState,
  defaultOpsView,
  driftNoticeLines,
  encodeOpsOverviewState,
  fieldFlag,
  isDrifted,
  lastRunFailed,
  lastRunText,
  matchesOpsQuery,
  moneyText,
  needsAttention,
  notFullyVerified,
  oneSourceWarning,
  opsRowOrder,
  pathKind,
  pathPercent,
  provenText,
  runStatsText,
  siteLastRunText,
  sortFooterText,
  sortRowsBy,
  totalsText,
  verifiedState,
  verifiedText,
  type OpsFieldPath,
  type OpsWebsiteRow,
} from './ops-view';

const NOW = new Date('2026-10-06T12:00:00Z');

function row(over: Partial<OpsWebsiteRow> & { sourceId: string }): OpsWebsiteRow {
  return {
    org: { id: 'org-1', name: 'Northwind', slug: 'northwind' },
    project: { name: 'Footwear prices', slug: 'footwear-prices' },
    website: { name: over.sourceId, slug: over.sourceId.toLowerCase(), host: `${over.sourceId.toLowerCase()}.example.com` },
    fields: 4,
    currentFields: 4,
    drifted: 0,
    lastRun: null,
    spentThisMonthUsd: 0,
    ...over,
  };
}

describe('isDrifted / lastRunFailed / notFullyVerified / needsAttention', () => {
  it('reads each reason independently', () => {
    expect(isDrifted(row({ sourceId: 'a', drifted: 1 }))).toBe(true);
    expect(isDrifted(row({ sourceId: 'a', drifted: 0 }))).toBe(false);

    expect(lastRunFailed(row({ sourceId: 'a', lastRun: { status: 'failed', at: NOW.toISOString() } }))).toBe(true);
    expect(lastRunFailed(row({ sourceId: 'a', lastRun: { status: 'completed', at: NOW.toISOString() } }))).toBe(false);
    expect(lastRunFailed(row({ sourceId: 'a', lastRun: null }))).toBe(false);

    expect(notFullyVerified(row({ sourceId: 'a', fields: 4, currentFields: 3 }))).toBe(true);
    expect(notFullyVerified(row({ sourceId: 'a', fields: 4, currentFields: 4 }))).toBe(false);

    expect(needsAttention(row({ sourceId: 'a', drifted: 0, currentFields: 4, fields: 4, lastRun: { status: 'completed', at: NOW.toISOString() } }))).toBe(false);
    expect(needsAttention(row({ sourceId: 'a', currentFields: 2, fields: 4 }))).toBe(true);
  });
});

describe('opsRowOrder', () => {
  it('sorts drift first, then a failed last run, then not fully verified, then the rest — each group by most recent activity', () => {
    const healthyOld = row({ sourceId: 'healthy-old', lastRun: { status: 'completed', at: '2026-10-01T00:00:00Z' } });
    const healthyNew = row({ sourceId: 'healthy-new', lastRun: { status: 'completed', at: '2026-10-05T00:00:00Z' } });
    const unverified = row({ sourceId: 'unverified', currentFields: 1, lastRun: { status: 'completed', at: '2026-10-04T00:00:00Z' } });
    const failed = row({ sourceId: 'failed', lastRun: { status: 'failed', at: '2026-10-02T00:00:00Z' } });
    const driftedOld = row({ sourceId: 'drifted-old', drifted: 1, lastRun: { status: 'completed', at: '2026-10-01T00:00:00Z' } });
    const driftedNew = row({ sourceId: 'drifted-new', drifted: 2, lastRun: { status: 'completed', at: '2026-10-03T00:00:00Z' } });
    const neverRun = row({ sourceId: 'never-run', lastRun: null });

    const ordered = opsRowOrder([healthyOld, healthyNew, unverified, failed, driftedOld, driftedNew, neverRun]);

    expect(ordered.map((r) => r.sourceId)).toEqual([
      'drifted-new', // drift, most recent first
      'drifted-old',
      'failed', // then a failed last run
      'unverified', // then not fully verified
      'healthy-new', // then the rest, most recent first
      'healthy-old',
      'never-run', // never run sorts last within its group
    ]);
  });

  it('does not mutate its input', () => {
    const rows = [row({ sourceId: 'b' }), row({ sourceId: 'a' })];
    const copy = [...rows];
    opsRowOrder(rows);
    expect(rows).toEqual(copy);
  });
});

describe('verifiedText / verifiedState', () => {
  it('matches the Global Constraints exactly', () => {
    expect(verifiedText(0, 6)).toBe('Not verified');
    expect(verifiedState(0, 6)).toBe('fail');

    expect(verifiedText(4, 6)).toBe('4 of 6 fields');
    expect(verifiedState(4, 6)).toBe('warn');

    expect(verifiedText(6, 6)).toBe('6 of 6 fields');
    expect(verifiedState(6, 6)).toBe('pass');
  });
});

describe('lastRunText', () => {
  it('"No runs" when there has never been one', () => {
    expect(lastRunText(null)).toBe('No runs');
  });

  it('"Running" for a run still in flight', () => {
    expect(lastRunText({ status: 'running', at: NOW.toISOString() }, NOW)).toBe('Running');
  });

  it('a relative time for a finished run', () => {
    expect(lastRunText({ status: 'completed', at: '2026-10-06T11:25:00Z' }, NOW)).toBe('35 min ago');
    expect(lastRunText({ status: 'failed', at: '2026-10-06T10:00:00Z' }, NOW)).toBe('2 h ago');
  });
});

describe('moneyText', () => {
  it('formats dollars, and zero as an em dash', () => {
    expect(moneyText(0)).toBe('—');
    expect(moneyText(3.4)).toBe('$3.40');
    expect(moneyText(0.03)).toBe('$0.03');
  });
});

describe('defaultOpsView', () => {
  it('opens on "Needs attention" only while something needs it', () => {
    expect(defaultOpsView(3)).toBe('attention');
    expect(defaultOpsView(0)).toBe('all');
  });
});

describe('sortRowsBy', () => {
  const low = row({ sourceId: 'low', spentThisMonthUsd: 1, lastRun: { status: 'completed', at: '2026-10-01T00:00:00Z' } });
  const high = row({ sourceId: 'high', spentThisMonthUsd: 9, lastRun: { status: 'completed', at: '2026-10-05T00:00:00Z' } });
  const never = row({ sourceId: 'never', spentThisMonthUsd: 0, lastRun: null });

  it('spend-desc: highest first; spend-asc: reversed', () => {
    expect(sortRowsBy([low, high, never], 'spend-desc').map((r) => r.sourceId)).toEqual(['high', 'low', 'never']);
    expect(sortRowsBy([low, high, never], 'spend-asc').map((r) => r.sourceId)).toEqual(['never', 'low', 'high']);
  });

  it('run-desc: most recent first, never-run last; run-asc: reversed', () => {
    expect(sortRowsBy([low, high, never], 'run-desc').map((r) => r.sourceId)).toEqual(['high', 'low', 'never']);
    expect(sortRowsBy([low, high, never], 'run-asc').map((r) => r.sourceId)).toEqual(['never', 'low', 'high']);
  });
});

describe('sortFooterText / totalsText', () => {
  it('names the active sort, or the default order', () => {
    expect(sortFooterText(undefined)).toBe('Sorted by what needs you, then most recent activity');
    expect(sortFooterText('run-desc')).toBe('Sorted by last run');
    expect(sortFooterText('spend-asc')).toBe('Sorted by spend this month');
  });

  it('counts websites and customers, singular and plural', () => {
    expect(totalsText(1, 1)).toBe('1 website across 1 customer');
    expect(totalsText(8, 3)).toBe('8 websites across 3 customers');
  });
});

describe('OPS_REASONS', () => {
  it('each reason\'s test matches the row helper it names', () => {
    const drifted = row({ sourceId: 'a', drifted: 1 });
    const failed = row({ sourceId: 'b', lastRun: { status: 'failed', at: NOW.toISOString() } });
    const unverified = row({ sourceId: 'c', currentFields: 1 });
    expect(OPS_REASONS.find((r) => r.key === 'drift')!.test(drifted)).toBe(true);
    expect(OPS_REASONS.find((r) => r.key === 'failed')!.test(failed)).toBe(true);
    expect(OPS_REASONS.find((r) => r.key === 'unverified')!.test(unverified)).toBe(true);
  });
});

describe('matchesOpsQuery', () => {
  const r = row({ sourceId: 'nike-x' });
  r.website.name = 'Nike';
  r.website.host = 'www.nike.com';
  r.org.name = 'Northwind';
  r.project.name = 'Footwear prices';

  it('matches website name, host, customer and project, case-insensitively', () => {
    expect(matchesOpsQuery(r, '')).toBe(true);
    expect(matchesOpsQuery(r, 'nike')).toBe(true);
    expect(matchesOpsQuery(r, 'NIKE.COM')).toBe(true);
    expect(matchesOpsQuery(r, 'northwind')).toBe(true);
    expect(matchesOpsQuery(r, 'footwear')).toBe(true);
    expect(matchesOpsQuery(r, 'allbirds')).toBe(false);
  });
});

// ─── `/ops/websites/$sourceId` (cut-over Task 4) ────────────────────────────

function path(over: Partial<OpsFieldPath>): OpsFieldPath {
  return { source: 'api', path: 'x', uses: 0, hits: 0, ...over };
}

describe('pathKind', () => {
  it('names each certified source in the customer\'s own words (Global Constraints)', () => {
    expect(pathKind('api')).toBe('API');
    expect(pathKind('json-ld')).toBe('Page data');
    expect(pathKind('meta')).toBe('Meta');
    expect(pathKind('xpath')).toBe('Page element');
  });
});

describe('provenText', () => {
  const proofUrls = ['https://x.example/p/1', 'https://x.example/p/2', 'https://x.example/p/3'];

  it('reads "all proof pages" with no provenOn', () => {
    expect(provenText(undefined, proofUrls)).toBe('all proof pages');
  });

  it('names one page singular', () => {
    expect(provenText([proofUrls[0]!], proofUrls)).toBe('product 1');
  });

  it('joins two pages with "and"', () => {
    expect(provenText([proofUrls[0]!, proofUrls[2]!], proofUrls)).toBe('products 1 and 3');
  });

  it('joins three or more with a comma and a trailing "and"', () => {
    expect(provenText([proofUrls[0]!, proofUrls[1]!, proofUrls[2]!], proofUrls)).toBe('products 1, 2 and 3');
  });

  it('sorts by position, not by the order provenOn lists them', () => {
    expect(provenText([proofUrls[2]!, proofUrls[0]!], proofUrls)).toBe('products 1 and 3');
  });

  it('falls back to "all proof pages" when none of provenOn\'s urls are on the current proof list', () => {
    expect(provenText(['https://gone.example/p/9'], proofUrls)).toBe('all proof pages');
  });
});

describe('runStatsText / pathPercent', () => {
  it('reads "Not needed yet" for 0 uses, never "0 %"', () => {
    expect(runStatsText(0, 0)).toBe('Not needed yet');
    expect(pathPercent(0, 0)).toBeNull();
  });

  it('reads "{hits} of {uses} ({pct} %)", rounded', () => {
    expect(runStatsText(1248, 812)).toBe('812 of 1248 (65 %)');
    expect(pathPercent(1248, 812)).toBe(65);
  });

  it('reads 100 % when every use hit', () => {
    expect(runStatsText(8, 8)).toBe('8 of 8 (100 %)');
  });
});

describe('oneSourceWarning', () => {
  it('is null for a single path, however it reads', () => {
    expect(oneSourceWarning([path({ source: 'api' })])).toBeNull();
  });

  it('fires for three api paths with no recorded containers', () => {
    const paths = [path({ source: 'api' }), path({ source: 'api' }), path({ source: 'api' })];
    expect(oneSourceWarning(paths)).toBe(ONE_SOURCE_WARNING);
  });

  it('fires for api paths that all share the same recorded container', () => {
    const paths = [path({ source: 'api', container: 'https://x.example/api/a' }), path({ source: 'api', container: 'https://x.example/api/a' })];
    expect(oneSourceWarning(paths)).toBe(ONE_SOURCE_WARNING);
  });

  it('is null for api paths with two different recorded containers', () => {
    const paths = [path({ source: 'api', container: 'https://x.example/api/a' }), path({ source: 'api', container: 'https://x.example/api/b' })];
    expect(oneSourceWarning(paths)).toBeNull();
  });

  it('fires for every path being json-ld', () => {
    expect(oneSourceWarning([path({ source: 'json-ld' }), path({ source: 'json-ld' })])).toBe(ONE_SOURCE_WARNING);
  });

  it('is absent for an api + json-ld mix', () => {
    expect(oneSourceWarning([path({ source: 'api' }), path({ source: 'json-ld' })])).toBeNull();
  });
});

describe('backupsSummary', () => {
  it('names the first path\'s kind and the backup count', () => {
    expect(backupsSummary([path({ source: 'api' })])).toBe('API, no backups');
    expect(backupsSummary([path({ source: 'api' }), path({ source: 'json-ld' })])).toBe('API, 1 backup');
    expect(backupsSummary([path({ source: 'json-ld' }), path({ source: 'api' }), path({ source: 'api' })])).toBe('Page data, 2 backups');
  });
});

describe('fieldFlag', () => {
  it('ranks drift above a shared source above a weak first path, and is null otherwise', () => {
    expect(fieldFlag({ drifted: true, oneSource: true, firstPathPct: 40 })).toBe('Stopped extracting');
    expect(fieldFlag({ drifted: false, oneSource: true, firstPathPct: 40 })).toBe('Backups share one source');
    expect(fieldFlag({ drifted: false, oneSource: false, firstPathPct: 40 })).toBe('First path finds it on 40 %');
    expect(fieldFlag({ drifted: false, oneSource: false, firstPathPct: 90 })).toBeNull();
    expect(fieldFlag({ drifted: false, oneSource: false, firstPathPct: null })).toBeNull();
  });
});

describe('siteLastRunText', () => {
  it('reads "No runs" with no last run', () => {
    expect(siteLastRunText(null)).toBe('No runs');
  });

  it('reads "Completed {time}, {rows} rows"', () => {
    expect(siteLastRunText({ status: 'completed', at: '2026-10-06T10:00:00Z', rows: 1248 }, NOW)).toBe('Completed 2 h ago, 1,248 rows');
  });

  it('reads "Failed {time}" with no row count', () => {
    expect(siteLastRunText({ status: 'failed', at: '2026-10-06T11:25:00Z', rows: null }, NOW)).toBe('Failed 35 min ago');
  });

  it('reads "Running" alone, whatever its time or rows', () => {
    expect(siteLastRunText({ status: 'running', at: NOW.toISOString(), rows: null }, NOW)).toBe('Running');
  });
});

describe('driftNoticeLines', () => {
  const proofUrls = ['https://x.example/p/1', 'https://x.example/p/2', 'https://x.example/p/3'];
  const fieldNames = { price: 'Price', size: 'Size' };

  it('is empty with no results', () => {
    expect(driftNoticeLines({ driftedKeys: ['price'], fieldNames, results: null, proofUrls })).toEqual([]);
  });

  it('names moved, other-layout and lost with their exact texts', () => {
    expect(
      driftNoticeLines({
        driftedKeys: ['price', 'size'],
        fieldNames,
        results: {
          fields: {
            price: { key: 'price', result: 'moved', pages: {} },
            size: { key: 'size', result: 'lost', pages: {} },
          },
        },
        proofUrls,
      }),
    ).toEqual([
      { name: 'Price', text: 'Moved on the page — a new location is proposed' },
      { name: 'Size', text: 'Not found on the page' },
    ]);
  });

  it('reads "Page now shows {new} (was {old})" for a single changed page, naming pages when more than one changed', () => {
    const one = driftNoticeLines({
      driftedKeys: ['price'],
      fieldNames,
      results: { fields: { price: { key: 'price', result: 'changed', pages: { [proofUrls[0]!]: { status: 'ok', value: '12.99', was: '9.99', changed: true } } } } },
      proofUrls,
    });
    expect(one).toEqual([{ name: 'Price', text: 'Page now shows 12.99 (was 9.99)' }]);

    const two = driftNoticeLines({
      driftedKeys: ['price'],
      fieldNames,
      results: {
        fields: {
          price: {
            key: 'price',
            result: 'changed',
            pages: {
              [proofUrls[0]!]: { status: 'ok', value: '12.99', was: '9.99', changed: true },
              [proofUrls[2]!]: { status: 'ok', value: '14.99', was: '10.99', changed: true },
            },
          },
        },
      },
      proofUrls,
    });
    expect(two).toEqual([{ name: 'Price', text: 'Page now shows 12.99 (was 9.99) on product 1; Page now shows 14.99 (was 10.99) on product 3' }]);
  });

  it('skips an unchanged page and ignores a field with no entry in results', () => {
    expect(
      driftNoticeLines({
        driftedKeys: ['price', 'size'],
        fieldNames,
        results: { fields: { price: { key: 'price', result: 'changed', pages: { [proofUrls[0]!]: { status: 'ok', value: '9.99', changed: false } } } } },
        proofUrls,
      }),
    ).toEqual([{ name: 'Price', text: 'Page now shows a different value' }]);
  });

  it('adds one "Product {n} no longer loads" line per gone proof page, alongside the field\'s own result', () => {
    expect(
      driftNoticeLines({
        driftedKeys: ['price'],
        fieldNames,
        results: { fields: { price: { key: 'price', result: 'lost', pages: { [proofUrls[1]!]: { status: 'page-gone' } } } } },
        proofUrls,
      }),
    ).toEqual([
      { name: 'Price', text: 'Not found on the page' },
      { name: 'Price', text: 'Product 2 no longer loads' },
    ]);
  });
});

describe('encodeOpsOverviewState / decodeOpsOverviewState', () => {
  it('round-trips every field', () => {
    const state = { view: 'attention' as const, reason: 'drift' as const, q: 'nike', customer: 'org-1', sort: 'spend-desc' as const };
    expect(decodeOpsOverviewState(encodeOpsOverviewState(state))).toEqual(state);
  });

  it('encodes nothing for empty state, and decodes that back to empty', () => {
    expect(encodeOpsOverviewState({})).toBe('');
    expect(decodeOpsOverviewState('')).toEqual({});
    expect(decodeOpsOverviewState(undefined)).toEqual({});
  });

  it('drops an invalid or tampered value rather than carrying it through', () => {
    expect(decodeOpsOverviewState('view=nonsense&reason=nonsense&sort=nonsense')).toEqual({});
  });
});
