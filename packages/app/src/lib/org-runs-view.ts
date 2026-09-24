import { runsView, type RunRow, type RunView } from './runs-view';

/** One row of `runs.listByOrg`: a website's run row plus where it belongs. */
export type OrgRunRow = RunRow & {
  costUsd: number;
  project: { name: string; slug: string };
  website: { name: string; slug: string };
};

export type OrgRunView = RunView & {
  projectName: string;
  projectSlug: string;
  websiteName: string;
  websiteSlug: string;
};

/**
 * The org-wide table is the website table with two more columns: the same
 * words for the same run (`runsView` is the one place a run is put into
 * words), joined back to its project and website by id.
 */
export function orgRunsView(rows: readonly OrgRunRow[], now: Date = new Date()): OrgRunView[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return runsView(rows, now).map((view) => {
    const row = byId.get(view.id)!;
    return {
      ...view,
      projectName: row.project.name,
      projectSlug: row.project.slug,
      websiteName: row.website.name,
      websiteSlug: row.website.slug,
    };
  });
}

/** The poll's stop condition: refetch only while something is actually moving. */
export function anyRunning(views: readonly { state: RunView['state'] }[]): boolean {
  return views.some((v) => v.state === 'running');
}
