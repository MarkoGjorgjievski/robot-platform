// One-off (spec 4.5): lift each website's field list into its project's dataset.
import { eq } from 'drizzle-orm';
import { db, projects, datasets, sources } from '../index.js';
import type { Database } from '../index.js';

type Field = { key: string; name: string; type: string; description?: string; concept: string };
type Entry = Record<string, unknown> & { key?: string; name?: string; type?: string; concept?: string };

export async function liftContracts(database: Database, opts: { projectIds?: string[] } = {}) {
  const conflicts: Array<{ datasetId: string; key: string; kept: string; ignored: string; sourceId: string }> = [];
  let projectsGivenDataset = 0;
  let datasetsUpdated = 0;

  const allProjects = await database.query.projects.findMany({ with: { datasets: { columns: { id: true } } } });
  const scopedProjects = opts.projectIds ? allProjects.filter((p) => opts.projectIds!.includes(p.id)) : allProjects;
  for (const p of scopedProjects) {
    if (p.datasets.length === 0) {
      await database.insert(datasets).values({ projectId: p.id, name: p.name, slug: p.slug, schema: [] });
      projectsGivenDataset++;
    }
  }

  const allDatasets = await database.query.datasets.findMany({
    with: { sources: { columns: { id: true, schemaDefinition: true }, orderBy: (s, { asc }) => [asc(s.createdAt), asc(s.id)] } },
  });
  const scopedDatasets = opts.projectIds ? allDatasets.filter((d) => opts.projectIds!.includes(d.projectId)) : allDatasets;
  for (const ds of scopedDatasets) {
    const schema: Entry[] = Array.isArray(ds.schema) ? [...(ds.schema as Entry[])] : [];
    let changed = false;
    // Earliest-created source wins a type disagreement; later ones are recorded as conflicts.
    for (const s of ds.sources) {
      if (!Array.isArray(s.schemaDefinition)) continue;
      for (const f of s.schemaDefinition as Field[]) {
        const keyed = schema.find((e) => e.key === f.key);
        if (keyed) {
          if (keyed.type !== f.type) conflicts.push({ datasetId: ds.id, key: f.key, kept: String(keyed.type), ignored: f.type, sourceId: s.id });
          continue;
        }
        const legacy = schema.find((e) => !e.key && typeof e.name === 'string' && e.name.toLowerCase() === f.name.toLowerCase());
        if (legacy) { legacy.key = f.key; legacy.type = f.type; legacy.concept = f.concept; }
        else schema.push({ key: f.key, name: f.name, type: f.type, concept: f.concept });
        changed = true;
      }
    }
    if (changed) {
      await database.update(datasets).set({ schema, updatedAt: new Date() }).where(eq(datasets.id, ds.id));
      datasetsUpdated++;
    }
  }
  return { datasetsUpdated, projectsGivenDataset, conflicts };
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('/lift-contracts.ts');
if (isMain) {
  liftContracts(db).then((r) => {
    console.log(`datasets updated: ${r.datasetsUpdated}; projects given a dataset: ${r.projectsGivenDataset}`);
    for (const c of r.conflicts) console.log(`conflict: dataset ${c.datasetId} field ${c.key}: kept ${c.kept}, ignored ${c.ignored} from source ${c.sourceId} (review by hand)`);
    process.exit(0);
  }).catch((err) => { console.error(err); process.exit(1); });
}
