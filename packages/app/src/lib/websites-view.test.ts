import { describe, it, expect } from 'vitest';
import { verifiedLabel, websitesView, type WebsiteRow } from './websites-view';

const NOW = new Date('2026-09-21T12:00:00Z');
function row(over: Partial<WebsiteRow> & { name: string }): WebsiteRow {
  return { id: over.name, slug: over.name.toLowerCase(), url: `https://${over.name.toLowerCase()}.example.com/`, verifiedFields: 0, lastRun: null, ...over };
}

describe('verifiedLabel', () => {
  it('reads as the customer would say it', () => {
    expect(verifiedLabel(0, 0)).toEqual({ label: 'No fields yet', state: 'no-fields' });
    expect(verifiedLabel(0, 8)).toEqual({ label: 'Not verified', state: 'none' });
    expect(verifiedLabel(3, 8)).toEqual({ label: '3 of 8 verified', state: 'partial' });
    expect(verifiedLabel(8, 8)).toEqual({ label: 'All 8 verified', state: 'all' });
    expect(verifiedLabel(1, 1)).toEqual({ label: 'All 1 verified', state: 'all' });
    // A deleted field whose certification row survives: clamped, never "9 of 8".
    expect(verifiedLabel(9, 8)).toEqual({ label: 'All 8 verified', state: 'all' });
  });
});

describe('websitesView', () => {
  it('formats hostname, verification, the run dot and the row count; sorted by name', () => {
    const views = websitesView(
      [
        row({ name: 'Zed', verifiedFields: 8, lastRun: { status: 'completed', createdAt: new Date('2026-09-21T09:00:00Z'), completedAt: new Date('2026-09-21T09:05:00Z'), resultCount: 120 } }),
        row({ name: 'Alpha', url: 'https://shop.alpha.co.uk/p/1' }),
      ],
      8,
      NOW,
    );
    expect(views.map((v) => v.name)).toEqual(['Alpha', 'Zed']);
    expect(views[0]).toMatchObject({ hostname: 'shop.alpha.co.uk', verifiedLabel: 'Not verified', verifiedState: 'none', lastRunState: 'idle', lastRunLabel: null, rowsLabel: null });
    expect(views[1]).toMatchObject({ hostname: 'zed.example.com', verifiedLabel: 'All 8 verified', verifiedState: 'all', lastRunState: 'done', lastRunLabel: '3 h ago', rowsLabel: '120 rows' });
  });

  it('one row is "1 row"', () => {
    const [v] = websitesView([row({ name: 'A', lastRun: { status: 'completed', createdAt: NOW, completedAt: NOW, resultCount: 1 } })], 2, NOW);
    expect(v!.rowsLabel).toBe('1 row');
  });
});
