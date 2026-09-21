import { describe, expect, it } from 'vitest';
import { countsLabel, isoDate, projectsView, relativeTime, type ProjectRow } from './projects-view';

const NOW = new Date('2026-09-21T12:00:00Z');

function row(over: Partial<ProjectRow> & { name: string }): ProjectRow {
  return {
    id: over.name,
    slug: over.name.toLowerCase(),
    sourceCount: 0,
    fieldCount: 0,
    lastRun: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

describe('relativeTime', () => {
  const cases: Array<[string, Date, string]> = [
    ['0 s', new Date(NOW), 'just now'],
    ['59 s', new Date(NOW.getTime() - 59_000), 'just now'],
    ['5 min', new Date(NOW.getTime() - 5 * 60_000), '5 min ago'],
    ['3 h', new Date(NOW.getTime() - 3 * 3_600_000), '3 h ago'],
    ['2 d', new Date(NOW.getTime() - 2 * 86_400_000), '2 d ago'],
    ['30 d', new Date(NOW.getTime() - 30 * 86_400_000), '30 d ago'],
  ];

  for (const [label, at, expected] of cases) {
    it(`${label} ago reads "${expected}"`, () => {
      expect(relativeTime(at, NOW)).toBe(expected);
    });
  }

  it('rolls over at each boundary', () => {
    expect(relativeTime(new Date(NOW.getTime() - 60_000), NOW)).toBe('1 min ago');
    expect(relativeTime(new Date(NOW.getTime() - 59 * 60_000), NOW)).toBe('59 min ago');
    expect(relativeTime(new Date(NOW.getTime() - 3_600_000), NOW)).toBe('1 h ago');
    expect(relativeTime(new Date(NOW.getTime() - 23 * 3_600_000), NOW)).toBe('23 h ago');
    expect(relativeTime(new Date(NOW.getTime() - 86_400_000), NOW)).toBe('1 d ago');
  });

  it('says years once days stop being readable', () => {
    expect(relativeTime(new Date(NOW.getTime() - 364 * 86_400_000), NOW)).toBe('364 d ago');
    expect(relativeTime(new Date(NOW.getTime() - 365 * 86_400_000), NOW)).toBe('1 y ago');
    expect(relativeTime(new Date(NOW.getTime() - 800 * 86_400_000), NOW)).toBe('2 y ago');
  });

  it('never reads as the future when a clock is a little ahead', () => {
    expect(relativeTime(new Date(NOW.getTime() + 30_000), NOW)).toBe('just now');
  });
});

describe('isoDate', () => {
  it('is a sortable, locale-free date', () => {
    expect(isoDate(new Date('2026-09-01T23:30:00Z'))).toBe('2026-09-01');
    expect(isoDate(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
  });
});

describe('countsLabel', () => {
  it('reads "websites n · fields m"', () => {
    expect(countsLabel(3, 12)).toBe('websites 3 · fields 12');
    expect(countsLabel(0, 0)).toBe('websites 0 · fields 0');
  });
});

describe('projectsView', () => {
  it('sorts by name, ignoring case', () => {
    const view = projectsView([row({ name: 'zebra' }), row({ name: 'Acne' }), row({ name: 'beta' })], NOW);
    expect(view.map((v) => v.name)).toEqual(['Acne', 'beta', 'zebra']);
  });

  it('carries the counts through as numbers and as the label', () => {
    const [v] = projectsView([row({ name: 'Acne', sourceCount: 3, fieldCount: 12 })], NOW);
    expect(v!.websites).toBe(3);
    expect(v!.fields).toBe(12);
    expect(v!.countsLabel).toBe('websites 3 · fields 12');
  });

  // Null, not "—": the em dash is the table's way of drawing "nothing", and a
  // dot whose tooltip read "Idle · —" would be repeating punctuation at people.
  it('has no last-run label and an idle dot when a project has never run', () => {
    const [v] = projectsView([row({ name: 'Acne' })], NOW);
    expect(v!.lastRunState).toBe('idle');
    expect(v!.lastRunLabel).toBeNull();
  });

  it('dates and states the last run', () => {
    const [v] = projectsView(
      [
        row({
          name: 'Acne',
          lastRun: { createdAt: new Date(NOW.getTime() - 3 * 3_600_000), resultCount: 7, status: 'completed' },
        }),
      ],
      NOW,
    );
    expect(v!.lastRunState).toBe('done');
    expect(v!.lastRunLabel).toBe('3 h ago');
  });

  it('falls back to idle when the run carries no status', () => {
    const [v] = projectsView(
      [row({ name: 'Acne', lastRun: { createdAt: new Date(NOW.getTime() - 60_000), resultCount: 1 } })],
      NOW,
    );
    expect(v!.lastRunState).toBe('idle');
    expect(v!.lastRunLabel).toBe('1 min ago');
  });

  it('formats the created date', () => {
    const [v] = projectsView([row({ name: 'Acne', createdAt: new Date('2026-08-14T09:00:00Z') })], NOW);
    expect(v!.createdLabel).toBe('2026-08-14');
  });

  it('is empty for no rows', () => {
    expect(projectsView([], NOW)).toEqual([]);
  });

  it('does not mutate the rows it is given', () => {
    const rows = [row({ name: 'zebra' }), row({ name: 'Acne' })];
    projectsView(rows, NOW);
    expect(rows.map((r) => r.name)).toEqual(['zebra', 'Acne']);
  });
});
