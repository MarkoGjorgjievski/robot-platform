// packages/api/src/crawl/variant-run-plan.ts
// A run's variant plan (spec 2026-10-02-variants-plan3, Task 2): the certified
// collector/list state plus enough of the contract (fields with their
// effective level, the mapped axes that still exist, the sku/gtin keys) for
// Task 3's row builder to turn one product page into one row per variant.
// Read once per run, from the certification `start-execution.ts` already
// loaded — never a second, independent currency check.
import { eq } from 'drizzle-orm';
import { sources } from '@robot/db';
import type { Database } from '@robot/db';
import { type VariantRunPlan } from '@robot/scraper';
import { contractAxes, contractFields, effectiveLevel } from '../contract.js';
import type { VariantSetup } from '../contract.js';
import type { Certification } from '../verify/current-certification.js';

/**
 * `null` unless `cert.variants` is set (spec Global Constraints: variants apply to a run only
 * when its certification carries them). Otherwise builds the plan from the certified
 * method/list/entryPaths/fromProduct/collector, the dataset's contract fields (contract order,
 * each with its `effectiveLevel`), the setup's mapped axes that still exist on the dataset
 * (deduped by key, setup order), and the sku/gtin contract keys.
 */
export async function loadVariantRunPlan(db: Database, sourceId: string, cert: Certification | null): Promise<VariantRunPlan | null> {
  if (!cert?.variants) return null;

  // One query for both the website's axis mapping and the project's contract, the way
  // current-certification.ts's loadSourceRow does — so the plan's axes and fields always
  // describe the same binding state.
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { variantSetup: true },
    with: { dataset: { columns: { schema: true } } },
  });
  if (!source) return null;

  const setup = (source.variantSetup as VariantSetup | null) ?? null;
  const schema = source.dataset?.schema ?? [];
  const contract = contractFields(schema);
  const availableAxes = new Map(contractAxes(schema).map((a) => [a.key, a]));

  const axes: Array<{ key: string; name: string }> = [];
  const seenAxisKeys = new Set<string>();
  for (const mapped of setup?.axes ?? []) {
    const axis = availableAxes.get(mapped.axisKey);
    if (!axis || seenAxisKeys.has(axis.key)) continue;
    seenAxisKeys.add(axis.key);
    axes.push({ key: axis.key, name: axis.name });
  }

  const fields = contract.map((f) => ({ key: f.key, name: f.name, type: f.type, level: effectiveLevel(f) }));
  const skuKey = contract.find((f) => f.concept === 'sku')?.key;
  const gtinKey = contract.find((f) => f.concept === 'gtin' || f.concept === 'gtin13')?.key;

  return {
    method: cert.variants.method,
    ...(cert.variants.list ? { list: cert.variants.list } : {}),
    entryPaths: cert.variants.entryPaths ?? {},
    fromProduct: cert.variants.fromProduct ?? [],
    ...(cert.variants.collector ? { collector: cert.variants.collector } : {}),
    axes,
    fields,
    ...(skuKey ? { skuKey } : {}),
    ...(gtinKey ? { gtinKey } : {}),
  };
}
