// The project's output (spec 2026-09-21 §5): every website's latest completed
// run, side by side under one header. Built from `loadRunExport` per website so
// a project file and a run file can never disagree about a row.
import { and, desc, eq, isNotNull, inArray } from 'drizzle-orm';
import { datasets, projects, runs, sources } from '@robot/db';
import type { db as Database } from '@robot/db';
import { contractFields } from '../contract.js';
import { loadRunExport } from './load-run-export.js';

export type ProjectExport = {
  project: { id: string; name: string; slug: string };
  /** "Website" first, then the contract's names in schema order, then any extra column a website produced. */
  fields: string[];
  rows: Record<string, unknown>[];
  websites: Array<{ id: string; name: string; slug: string; runId: string | null; completedAt: string | null; rowCount: number }>;
  rowCount: number;
  generatedAt: string;
};

export const WEBSITE_COLUMN = 'Website';

export async function loadProjectExport(db: typeof Database, projectId: string): Promise<ProjectExport | null> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId), columns: { id: true, name: true, slug: true } });
  if (!project) return null;

  const dataset = await db.query.datasets.findFirst({
    where: eq(datasets.projectId, project.id),
    orderBy: (d, { asc }) => [asc(d.createdAt)],
    columns: { id: true, schema: true },
  });
  const contractNames = dataset ? contractFields(dataset.schema).map((f) => f.name) : [];

  const sites = dataset
    ? await db.select({ id: sources.id, name: sources.name, slug: sources.slug }).from(sources).where(eq(sources.datasetId, dataset.id)).orderBy(sources.name)
    : [];

  // The latest COMPLETED run per website. A failed or cancelled run is not
  // output; a run still going has nothing to export yet.
  const latest = sites.length
    ? await db
        .selectDistinctOn([runs.sourceId], { sourceId: runs.sourceId, id: runs.id, completedAt: runs.completedAt })
        .from(runs)
        .where(and(inArray(runs.sourceId, sites.map((s) => s.id)), eq(runs.status, 'completed'), isNotNull(runs.completedAt)))
        .orderBy(runs.sourceId, desc(runs.completedAt), desc(runs.id))
    : [];
  const latestBySource = new Map(latest.map((r) => [r.sourceId!, r]));

  const rows: Record<string, unknown>[] = [];
  const extras: string[] = [];
  const websites: ProjectExport['websites'] = [];
  for (const site of sites) {
    const run = latestBySource.get(site.id);
    const runExport = run ? await loadRunExport(db, run.id) : null;
    const siteRows = runExport?.rows ?? [];
    for (const r of siteRows) rows.push({ [WEBSITE_COLUMN]: site.name, ...r });
    for (const f of runExport?.fields ?? []) if (!contractNames.includes(f) && !extras.includes(f)) extras.push(f);
    websites.push({ id: site.id, name: site.name, slug: site.slug, runId: run?.id ?? null, completedAt: run?.completedAt?.toISOString() ?? null, rowCount: siteRows.length });
  }

  return {
    project,
    fields: [WEBSITE_COLUMN, ...contractNames, ...extras],
    rows,
    websites,
    rowCount: rows.length,
    generatedAt: new Date().toISOString(),
  };
}

export function projectExportFilename(x: ProjectExport, extension: 'csv' | 'json'): string {
  return `${x.project.slug}-${x.generatedAt.slice(0, 10)}.${extension}`;
}
