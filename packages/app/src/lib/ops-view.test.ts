import { describe, it, expect } from 'vitest';
import {
  OPS_REASONS,
  defaultOpsView,
  isDrifted,
  lastRunFailed,
  lastRunText,
  matchesOpsQuery,
  moneyText,
  needsAttention,
  notFullyVerified,
  opsRowOrder,
  sortFooterText,
  sortRowsBy,
  totalsText,
  verifiedState,
  verifiedText,
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
