import { describe, expect, it } from 'vitest';
import { LIMIT_REACHED, capCell, matchesOrgQuery, opsOrgMonths, opsOrgsView, percentCell, type OpsOrgRow } from './ops-orgs-view';

const row = (over: Partial<OpsOrgRow> = {}): OpsOrgRow => ({
  org: { id: 'o1', name: 'Acme Shop', slug: 'acme-shop' }, websites: 2, pages: 140, runs: 3, aiUsd: 30, jevUsd: 0.0123,
  capUsd: 25, capIsDefault: true, ownCapUsd: null, defaultCapUsd: 25, remainingUsd: 0, percentUsed: 120, reached: true, ...over,
});

describe('the ops Organisations view (spec 2026-10-24 metering §2.4)', () => {
  it('labels each row, with the limit’s source, % used and the badge at 100 %', () => {
    expect(opsOrgsView([row()])[0]).toEqual({
      id: 'o1', name: 'Acme Shop', websitesLabel: '2 websites', pagesLabel: '140 pages', runsLabel: '3 runs', aiLabel: '$30.00',
      capLabel: '$25 (default)', percentLabel: '120%', reached: true, jevLabel: '$0.01',
    });
    expect(LIMIT_REACHED).toBe('Limit reached');
    expect(capCell(row({ capUsd: 40, capIsDefault: false }))).toBe('$40');
    expect(capCell(row({ capUsd: null }))).toBe('No limit');
    expect([percentCell(null), percentCell(0), percentCell(0.7), percentCell(25), percentCell(99.6)]).toEqual(['—', '0%', '<1%', '25%', '100%']);
    expect(opsOrgsView([row({ jevUsd: 0, websites: 1, reached: false, percentUsed: 99.6 })])[0]).toMatchObject({ websitesLabel: '1 website', jevLabel: '—', reached: false, percentLabel: '100%' });
  });

  it('keeps the server’s order (highest % first) and filters by name', () => {
    const rows = [row(), row({ org: { id: 'o2', name: 'Bolt', slug: 'bolt' }, percentUsed: 10 })];
    expect(opsOrgsView(rows).map((r) => r.id)).toEqual(['o1', 'o2']);
    expect(rows.filter((r) => matchesOrgQuery(r, ' bOl ')).map((r) => r.org.id)).toEqual(['o2']);
    expect(rows.filter((r) => matchesOrgQuery(r, '')).length).toBe(2);
  });

  it('offers this month and the six before it, newest first, in UTC', () => {
    const months = opsOrgMonths(new Date('2026-02-28T23:30:00Z'));
    expect(months.map((m) => m.key)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11', '2025-10', '2025-09', '2025-08']);
    expect(months[0]!.label).toBe('February 2026');
  });
});
