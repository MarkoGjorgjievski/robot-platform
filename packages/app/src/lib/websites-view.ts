import { runDotState, type RunDotStatus } from './run-dot-view';
import { relativeTime } from './projects-view';
import { hostnameOf } from './site-name';

/** One website of `projects.get`, narrowed to what the table reads. */
export type WebsiteRow = {
  id: string;
  slug: string;
  name: string;
  url: string | null;
  verifiedFields: number;
  lastRun: { status: string; createdAt: Date; completedAt: Date | null; resultCount: number | null } | null;
};

/** How far a website's certification has got — drawn as a 2 px rail, never a wash (spec §4). */
export type VerifiedState = 'none' | 'partial' | 'all' | 'no-fields';

export type WebsiteView = {
  id: string;
  slug: string;
  name: string;
  hostname: string;
  verifiedLabel: string;
  verifiedState: VerifiedState;
  lastRunState: RunDotStatus;
  lastRunLabel: string | null;
  /** "120 rows" from the last run, or null when it produced no count. */
  rowsLabel: string | null;
};

/**
 * What the Verified cell says. "No fields yet" comes first on purpose: with no
 * fields on the project there is nothing to verify, and calling that "Not
 * verified" would blame the website for the contract being empty.
 */
export function verifiedLabel(verified: number, total: number): { label: string; state: VerifiedState } {
  if (total === 0) return { label: 'No fields yet', state: 'no-fields' };
  if (verified === 0) return { label: 'Not verified', state: 'none' };
  if (verified === total) return { label: `All ${total} verified`, state: 'all' };
  return { label: `${verified} of ${total} verified`, state: 'partial' };
}

/** Sorted by name and formatted for the table. Pure: the rows handed in are never touched. */
export function websitesView(rows: readonly WebsiteRow[], totalFields: number, now: Date = new Date()): WebsiteView[] {
  return [...rows]
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
    .map((w) => {
      const v = verifiedLabel(w.verifiedFields, totalFields);
      const count = w.lastRun?.resultCount;
      return {
        id: w.id,
        slug: w.slug,
        name: w.name,
        hostname: hostnameOf(w.url),
        verifiedLabel: v.label,
        verifiedState: v.state,
        lastRunState: runDotState(w.lastRun),
        lastRunLabel: w.lastRun ? relativeTime(w.lastRun.createdAt, now) : null,
        rowsLabel: count == null ? null : `${count} ${count === 1 ? 'row' : 'rows'}`,
      };
    });
}
