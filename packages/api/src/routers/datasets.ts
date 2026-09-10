import { z } from 'zod';
import { eq, sql, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { datasets, projects, orgs, sources, type Database } from '@robot/db';
import { CUSTOMER_FIELD_TYPES, DETAIL_URL_FIELD, deriveConcept, deriveKey, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { router, publicProcedure } from '../trpc';
import { contractFields, type ContractField } from '../contract.js';
import { loadFieldCurrency } from '../verify/current-certification.js';

/** One Dataset schema field. `origin` says WHERE the field is resolved; absent means 'detail'. */
export const datasetSchemaFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().optional(),
  description: z.string().optional(),
  origin: z.enum(['detail', 'listing', 'input', 'system']).optional(),
  input_column: z.string().optional(),
  /** The customer's explicit candidate choice for this field (v2.5 serving order). */
  candidate: z.object({ concept: z.string().min(1), label: z.string().min(1) }).optional(),
  /** The contract key + cache-bridge concept (spec 4.1/4.3), round-tripped by `updateSchema`. */
  key: z.string().optional(),
  concept: z.string().optional(),
});

async function loadDataset(db: Database, datasetId: string) {
  const ds = await db.query.datasets.findFirst({
    where: eq(datasets.id, datasetId),
    with: { sources: { columns: { id: true, slug: true, name: true, schemaDefinition: true, verificationSet: true } } },
  });
  if (!ds) throw new TRPCError({ code: 'NOT_FOUND', message: `Dataset ${datasetId} not found` });
  return ds;
}

function assertNameFree(contract: ContractField[], name: string, exceptKey?: string) {
  const lower = name.trim().toLowerCase();
  if (contract.some((f) => f.key !== exceptKey && f.name.trim().toLowerCase() === lower)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `A field named "${name}" already exists` });
  }
  if (deriveKey(name, new Set()) === DETAIL_URL_FIELD) throw new TRPCError({ code: 'BAD_REQUEST', message: `"${name}" is reserved` });
}

/** Apply `patch` to the source's binding + verification set for one key, or remove it when `patch` is null. */
async function propagate(
  tx: Pick<Database, 'update'>,
  srcs: Array<{ id: string; schemaDefinition: unknown; verificationSet: unknown }>,
  key: string,
  patch: Partial<SchemaDefinitionField> | { add: SchemaDefinitionField } | null,
): Promise<string[]> {
  const affected: string[] = [];
  for (const s of srcs) {
    const def = (Array.isArray(s.schemaDefinition) ? s.schemaDefinition : []) as SchemaDefinitionField[];
    const set = (s.verificationSet ?? null) as VerificationSet | null;
    let nextDef: SchemaDefinitionField[];
    let nextSet = set;
    if (patch === null) {
      nextDef = def.filter((f) => f.key !== key);
      if (set) nextSet = { ...set, expected: Object.fromEntries(Object.entries(set.expected).filter(([k]) => k !== key)) };
    } else if ('add' in patch) {
      if (def.some((f) => f.key === key)) continue;
      nextDef = [...def, patch.add];
      if (set) nextSet = { ...set, expected: { ...set.expected, [key]: Object.fromEntries(set.urls.map((u) => [u, ''])) } };
    } else {
      nextDef = def.map((f) => (f.key === key ? { ...f, ...patch } : f));
    }
    await tx.update(sources).set({ schemaDefinition: nextDef, verificationSet: nextSet, updatedAt: new Date() }).where(eq(sources.id, s.id));
    affected.push(s.id);
  }
  return affected;
}

export const datasetsRouter = router({
  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db
        .select({
          id: datasets.id,
          projectId: datasets.projectId,
          name: datasets.name,
          slug: datasets.slug,
          description: datasets.description,
          schema: datasets.schema,
          createdAt: datasets.createdAt,
          updatedAt: datasets.updatedAt,
          sourceCount: sql<number>`count(${sources.id})::int`,
        })
        .from(datasets)
        .leftJoin(sources, eq(datasets.id, sources.datasetId))
        .where(eq(datasets.projectId, input.projectId))
        .groupBy(datasets.id)
        .orderBy(datasets.name);

      return results;
    }),

  /** The project's contract (spec 4.1): the dataset schema's keyed fields, for the project home editor. */
  getContract: publicProcedure
    .input(z.object({ datasetId: z.string().uuid() }))
    .query(async ({ ctx, input }) => contractFields((await loadDataset(ctx.db, input.datasetId)).schema)),

  getBySlug: publicProcedure
    .input(
      z.object({
        orgSlug: z.string(),
        projectSlug: z.string(),
        datasetSlug: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ datasetId: datasets.id })
        .from(datasets)
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .where(
          and(
            eq(orgs.slug, input.orgSlug),
            eq(projects.slug, input.projectSlug),
            eq(datasets.slug, input.datasetSlug),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        throw new Error(
          `Dataset not found: ${input.orgSlug}/${input.projectSlug}/${input.datasetSlug}`,
        );
      }

      const dataset = await ctx.db.query.datasets.findFirst({
        where: eq(datasets.id, row.datasetId),
        with: {
          sources: true,
        },
      });

      if (!dataset) {
        throw new Error(
          `Dataset not found: ${input.orgSlug}/${input.projectSlug}/${input.datasetSlug}`,
        );
      }

      return dataset;
    }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(255),
        slug: z.string().min(1).max(255),
        description: z.string().nullable().optional(),
        schema: z.union([z.record(z.unknown()), z.array(z.unknown())]).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [dataset] = await ctx.db.insert(datasets).values(input).returning();
      return dataset;
    }),

  updateSchema: publicProcedure
    .input(
      z.object({
        datasetId: z.string().uuid(),
        schema: z.array(datasetSchemaFieldSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(datasets)
        .set({ schema: input.schema })
        .where(eq(datasets.id, input.datasetId))
        .returning();
      return updated;
    }),

  /** Spec 4.3: add a field to the project's contract; every website gets it empty. */
  addField: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), name: z.string().trim().min(1).max(100), type: z.enum(CUSTOMER_FIELD_TYPES) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDataset(ctx.db, input.datasetId);
      const schema = (Array.isArray(ds.schema) ? ds.schema : []) as Array<Record<string, unknown>>;
      const contract = contractFields(schema);
      assertNameFree(contract, input.name);
      const key = deriveKey(input.name, new Set(contract.map((f) => f.key)));
      const concept = deriveConcept(input.name, input.type);
      const field: ContractField = { key, name: input.name, type: input.type, concept };
      const affectedSourceIds = await ctx.db.transaction(async (tx) => {
        await tx.update(datasets).set({ schema: [...schema, field], updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        return propagate(tx, ds.sources, key, { add: { key, name: input.name, type: input.type, description: '', concept } });
      });
      return { key, name: input.name, type: input.type, concept, affectedSourceIds };
    }),

  renameField: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), key: z.string().min(1), name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDataset(ctx.db, input.datasetId);
      const schema = (Array.isArray(ds.schema) ? ds.schema : []) as Array<Record<string, unknown>>;
      const contract = contractFields(schema);
      if (!contract.some((f) => f.key === input.key)) throw new TRPCError({ code: 'NOT_FOUND', message: `Field ${input.key} not found` });
      assertNameFree(contract, input.name, input.key);
      const affectedSourceIds = await ctx.db.transaction(async (tx) => {
        await tx.update(datasets).set({ schema: schema.map((f) => (f.key === input.key ? { ...f, name: input.name } : f)), updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        return propagate(tx, ds.sources, input.key, { name: input.name });
      });
      return { key: input.key, name: input.name, affectedSourceIds };
    }),

  /** Refused while any website has a current certification for the field (spec 4.3). Concept is left alone: it is the cache bridge. */
  retypeField: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), key: z.string().min(1), type: z.enum(CUSTOMER_FIELD_TYPES) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDataset(ctx.db, input.datasetId);
      const schema = (Array.isArray(ds.schema) ? ds.schema : []) as Array<Record<string, unknown>>;
      if (!contractFields(schema).some((f) => f.key === input.key)) throw new TRPCError({ code: 'NOT_FOUND', message: `Field ${input.key} not found` });
      for (const s of ds.sources) {
        const { currentKeys } = await loadFieldCurrency(ctx.db, s.id);
        if (currentKeys.includes(input.key)) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `${s.name} has verified this field; delete and re-add it to change its type` });
        }
      }
      const affectedSourceIds = await ctx.db.transaction(async (tx) => {
        await tx.update(datasets).set({ schema: schema.map((f) => (f.key === input.key ? { ...f, type: input.type } : f)), updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        return propagate(tx, ds.sources, input.key, { type: input.type });
      });
      return { key: input.key, type: input.type, affectedSourceIds };
    }),

  deleteField: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDataset(ctx.db, input.datasetId);
      const schema = (Array.isArray(ds.schema) ? ds.schema : []) as Array<Record<string, unknown>>;
      if (!contractFields(schema).some((f) => f.key === input.key)) throw new TRPCError({ code: 'NOT_FOUND', message: `Field ${input.key} not found` });
      const affectedSourceIds = await ctx.db.transaction(async (tx) => {
        await tx.update(datasets).set({ schema: schema.filter((f) => f.key !== input.key), updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        return propagate(tx, ds.sources, input.key, null);
      });
      return { key: input.key, affectedSourceIds };
    }),

  /** "Verified on n of m websites" per field, for the project home (spec 5.3). */
  fieldStatus: publicProcedure
    .input(z.object({ datasetId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ds = await loadDataset(ctx.db, input.datasetId);
      const contract = contractFields(ds.schema);
      const perSource = await Promise.all(ds.sources.map(async (s) => ({ s, currentKeys: new Set((await loadFieldCurrency(ctx.db, s.id)).currentKeys) })));
      const out: Record<string, { verified: number; total: number; websites: Array<{ sourceId: string; slug: string; name: string; verified: boolean }> }> = {};
      for (const f of contract) {
        const websites = perSource.map(({ s, currentKeys }) => ({ sourceId: s.id, slug: s.slug, name: s.name, verified: currentKeys.has(f.key) }));
        out[f.key] = { verified: websites.filter((w) => w.verified).length, total: websites.length, websites };
      }
      return out;
    }),
});
