import { z } from 'zod';
import { eq, sql, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { datasets, projects, orgs, sources, type Database } from '@robot/db';
import { CUSTOMER_FIELD_TYPES, DETAIL_URL_FIELD, deriveConcept, deriveKey, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { router, publicProcedure, type Context } from '../trpc';
import { contractFields, contractAxes, effectiveLevel, type ContractField, type ContractAxis, type VariantMode, type FieldLevel, type VariantSetup } from '../contract.js';
import { loadFieldCurrency } from '../verify/current-certification.js';
import { CATALOGUE } from '../schema-catalogue.js';
import { resolveOrg } from '../auth/session.js';

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
    with: { sources: { columns: { id: true, slug: true, name: true, schemaDefinition: true, verificationSet: true, variantSetup: true } } },
  });
  if (!ds) throw new TRPCError({ code: 'NOT_FOUND', message: `Dataset ${datasetId} not found` });
  return ds;
}

/**
 * `loadDataset`, inside the resolved org (spec 2026-09-21 §6 as restated). A
 * dataset whose project belongs to another org is NOT_FOUND — the same word as
 * for one that does not exist, so a guessed id learns nothing.
 * TODO(cut-over, spec 2026-09-21 §2): the `'default'` fallback exists only for the
 * old dashboard, which calls these with no session; drop it when it is retired.
 */
async function loadDatasetInOrg(ctx: Context, datasetId: string) {
  const org = await resolveOrg(ctx, 'default');
  const ds = await loadDataset(ctx.db, datasetId);
  const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, ds.projectId), columns: { orgId: true } });
  if (!project || project.orgId !== org.id) throw new TRPCError({ code: 'NOT_FOUND', message: `Dataset ${datasetId} not found` });
  return ds;
}

/** Re-reads a dataset's sources with a row lock, inside the caller's transaction, right
 * before `propagate` writes them back wholesale. `loadDataset`'s `ds.sources` is read
 * outside any transaction (it also feeds `retypeField`'s pre-check and `fieldStatus`,
 * which have no write to protect), so a concurrent `updateBinding` commit between that
 * read and this mutation's write would otherwise be silently overwritten by `propagate`
 * writing back the stale copy. Locking here makes `updateBinding` block until this
 * transaction commits, instead of losing its write.
 *
 * `deleteAxis` reuses this same lock to re-check, under `FOR UPDATE`, that no website's
 * `variantSetup` maps to the axis being deleted — otherwise a `setVariantSetup` call
 * (Task 5) committing between `deleteAxis`'s pre-check and its write could map a website
 * to an axis this call is about to delete out from under it. `name` and `variantSetup`
 * are selected for that check; `propagate`'s callers ignore the extra columns.
 *
 * Exported (fix round 1) so `sources.setVariantSetup` can join the SAME locking
 * protocol: dataset-schema row first (`lockDatasetSchema`), then this —
 * always in that order, on both sides — so the two can never deadlock on each
 * other's locks, and one always blocks behind the other instead of racing it. */
export async function lockSources(tx: Pick<Database, 'select'>, datasetId: string) {
  return tx
    .select({ id: sources.id, name: sources.name, schemaDefinition: sources.schemaDefinition, verificationSet: sources.verificationSet, variantSetup: sources.variantSetup })
    .from(sources)
    .where(eq(sources.datasetId, datasetId))
    .for('update');
}

/** Re-reads the dataset's own row with a row lock, inside the caller's transaction, right
 * before the `UPDATE datasets` that rewrites its schema, and hands back the schema as
 * stored right now. `loadDataset`'s copy is read outside any transaction, so two
 * overlapping `addField` calls — two chips clicked in a row, which the catalogue makes
 * easy — both computed `[...schema, field]` from the same pre-transaction copy and the
 * second commit erased the first one's field. Locking here makes the second call block
 * until the first commits, then build its new schema (and re-derive its minted key and
 * its duplicate-name refusal) from what is actually stored.
 *
 * Exported (fix round 1) for the same reason as `lockSources`: `sources.setVariantSetup`
 * takes this lock first, always, before `lockSources` — the dataset-schema-then-sources
 * order `deleteAxis` already follows. */
export async function lockDatasetSchema(tx: Pick<Database, 'select'>, datasetId: string) {
  const [row] = await tx.select({ schema: datasets.schema }).from(datasets).where(eq(datasets.id, datasetId)).for('update');
  return (Array.isArray(row?.schema) ? row.schema : []) as Array<Record<string, unknown>>;
}

/** A field and an axis may not share a name (spec 2026-10-01 §2, constraints): checked against
 * both the contract's fields and its axes, whichever `name` is being minted for. */
function assertNameFree(contract: ContractField[], axes: ContractAxis[], name: string, exceptKey?: string) {
  const lower = name.trim().toLowerCase();
  if (contract.some((f) => f.key !== exceptKey && f.name.trim().toLowerCase() === lower)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `A field named "${name}" already exists` });
  }
  if (axes.some((a) => a.key !== exceptKey && a.name.trim().toLowerCase() === lower)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `A field named "${name}" already exists` });
  }
  if (deriveKey(name, new Set()) === DETAIL_URL_FIELD) throw new TRPCError({ code: 'BAD_REQUEST', message: `"${name}" is reserved` });
}

/**
 * Creates an axis column (spec 2026-10-01 §2): the name-free check against
 * both fields and axes, `deriveKey` over both key sets, and the schema
 * append, all under the caller's `lockDatasetSchema` row lock. The one place
 * an axis is minted — used by `addAxis` here and by Task 5's
 * `setVariantSetup` (a website's axis mapping may mint a new project axis on
 * the fly).
 */
export async function createAxis(tx: Pick<Database, 'select' | 'update'>, datasetId: string, name: string): Promise<ContractAxis> {
  const schema = await lockDatasetSchema(tx, datasetId);
  const contract = contractFields(schema);
  const axes = contractAxes(schema);
  assertNameFree(contract, axes, name);
  const key = deriveKey(name, new Set([...contract.map((f) => f.key), ...axes.map((a) => a.key)]));
  const axis: ContractAxis = { key, name, kind: 'axis', concept: 'axis' };
  await tx.update(datasets).set({ schema: [...schema, axis], updatedAt: new Date() }).where(eq(datasets.id, datasetId));
  return axis;
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
    .query(async ({ ctx, input }) => contractFields((await loadDatasetInOrg(ctx, input.datasetId)).schema)),

  /** The field catalogue for step 1 of the Schema tab (spec 2026-09-18 §2.1): static, all types at once. */
  catalogue: publicProcedure.query(() => CATALOGUE),

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

  /**
   * Bulk-saves the dataset schema — but only the parts of it that aren't the
   * contract (spec 4.1/4.3): a keyed entry's `name` and `type` are changed
   * exclusively via `renameField`/`retypeField` (the latter gated by
   * `loadFieldCurrency`'s certification lock), and keyed entries are added
   * or dropped exclusively via `addField`/`deleteField` (the latter
   * propagating to every website). Without this guard, a caller could
   * bulk-save a renamed or retyped keyed entry straight past those checks —
   * in particular past `retypeField`'s refusal to retype a field a website
   * has already verified. Unkeyed legacy entries, and every other property
   * of a keyed entry (`origin`, `candidate`, `required`, `input_column`,
   * `description`), may still change freely here.
   *
   * Pre-existing behaviour, now also covering axes: unlike `addField` et al.,
   * this reads the current schema outside any transaction and writes it back
   * wholesale with a plain `UPDATE`, no `lockDatasetSchema` row lock. A
   * concurrent `addAxis`/`setFieldLevel`/`addField` commit between this read
   * and this write is silently overwritten by this call's stale copy (echoed
   * back via the `axes`/`level` carry-forward added above, but from the
   * pre-write snapshot, not a re-read). Left as-is: this procedure is the old
   * dashboard's bulk "save origins" call, already scoped down to the parts of
   * the schema it owns, not a new race introduced here.
   */
  updateSchema: publicProcedure
    .input(
      z.object({
        datasetId: z.string().uuid(),
        schema: z.array(datasetSchemaFieldSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.db.query.datasets.findFirst({ where: eq(datasets.id, input.datasetId), columns: { schema: true } });
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: `Dataset ${input.datasetId} not found` });
      const currentByKey = new Map(contractFields(current.schema).map((f) => [f.key, f]));
      const axes = contractAxes(current.schema);
      const incomingKeys = new Set<string>();
      for (const entry of input.schema) {
        if (typeof entry.key !== 'string' || entry.key.length === 0) continue; // legacy unkeyed entry: free to change
        incomingKeys.add(entry.key);
        const existing = currentByKey.get(entry.key);
        if (!existing) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Fields are added and removed with addField and deleteField' });
        if (existing.name !== entry.name || existing.type !== entry.type) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Field names and types are changed with renameField and retypeField' });
        }
      }
      if (incomingKeys.size !== currentByKey.size) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Fields are added and removed with addField and deleteField' });
      }

      // This save doesn't know about `level` (changed exclusively via
      // `setFieldLevel`, spec 2026-10-01 §2) or axis entries (their own kind
      // of schema entry, added/renamed/deleted exclusively via
      // `addAxis`/`renameAxis`/`deleteAxis`) — both are carried forward
      // unchanged rather than dropped by a caller that never saw them.
      const nextFields = input.schema.map((entry) => {
        if (typeof entry.key !== 'string' || entry.key.length === 0) return entry;
        const existing = currentByKey.get(entry.key)!;
        return existing.level !== undefined ? { ...entry, level: existing.level } : entry;
      });

      const [updated] = await ctx.db
        .update(datasets)
        .set({ schema: [...nextFields, ...axes] })
        .where(eq(datasets.id, input.datasetId))
        .returning();
      return updated;
    }),

  /** Spec 4.3: add a field to the project's contract; every website gets it empty. */
  addField: publicProcedure
    .input(z.object({
      datasetId: z.string().uuid(),
      name: z.string().trim().min(1).max(100),
      type: z.enum(CUSTOMER_FIELD_TYPES),
      /** From the catalogue (spec 2026-09-18 §2.1): the website's default location hint, and what the field is in the engine's vocabulary. */
      description: z.string().trim().max(1000).optional(),
      concept: z.string().regex(/^[a-z][a-z0-9_]*$/).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // `loadDatasetInOrg` answers only "does this dataset exist, in this org"; the schema
      // the new field is appended to — and the name check and minted key derived from it —
      // come from the locked re-read inside the transaction.
      const ds = await loadDatasetInOrg(ctx, input.datasetId);
      return ctx.db.transaction(async (tx) => {
        const schema = await lockDatasetSchema(tx, ds.id);
        const contract = contractFields(schema);
        const axes = contractAxes(schema);
        assertNameFree(contract, axes, input.name);
        const key = deriveKey(input.name, new Set([...contract.map((f) => f.key), ...axes.map((a) => a.key)]));
        const concept = input.concept ?? deriveConcept(input.name, input.type);
        const description = input.description ?? '';
        const field: ContractField = { key, name: input.name, type: input.type, concept, ...(description ? { description } : {}) };
        await tx.update(datasets).set({ schema: [...schema, field], updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        const locked = await lockSources(tx, ds.id);
        const affectedSourceIds = await propagate(tx, locked, key, { add: { key, name: input.name, type: input.type, description, concept } });
        return { key, name: input.name, type: input.type, concept, description, affectedSourceIds };
      });
    }),

  renameField: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), key: z.string().min(1), name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDatasetInOrg(ctx, input.datasetId);
      const affectedSourceIds = await ctx.db.transaction(async (tx) => {
        const schema = await lockDatasetSchema(tx, ds.id);
        const contract = contractFields(schema);
        const axes = contractAxes(schema);
        if (!contract.some((f) => f.key === input.key)) throw new TRPCError({ code: 'NOT_FOUND', message: `Field ${input.key} not found` });
        assertNameFree(contract, axes, input.name, input.key);
        await tx.update(datasets).set({ schema: schema.map((f) => (f.key === input.key ? { ...f, name: input.name } : f)), updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        const locked = await lockSources(tx, ds.id);
        return propagate(tx, locked, input.key, { name: input.name });
      });
      return { key: input.key, name: input.name, affectedSourceIds };
    }),

  /** Refused while any website has a current certification for the field (spec 4.3). Concept is left alone: it is the cache bridge. */
  retypeField: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), key: z.string().min(1), type: z.enum(CUSTOMER_FIELD_TYPES) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDatasetInOrg(ctx, input.datasetId);
      for (const s of ds.sources) {
        const { currentKeys } = await loadFieldCurrency(ctx.db, s.id);
        if (currentKeys.includes(input.key)) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `${s.name} has verified this field; delete and re-add it to change its type` });
        }
      }
      const affectedSourceIds = await ctx.db.transaction(async (tx) => {
        const schema = await lockDatasetSchema(tx, ds.id);
        if (!contractFields(schema).some((f) => f.key === input.key)) throw new TRPCError({ code: 'NOT_FOUND', message: `Field ${input.key} not found` });
        await tx.update(datasets).set({ schema: schema.map((f) => (f.key === input.key ? { ...f, type: input.type } : f)), updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        const locked = await lockSources(tx, ds.id);
        return propagate(tx, locked, input.key, { type: input.type });
      });
      return { key: input.key, type: input.type, affectedSourceIds };
    }),

  deleteField: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDatasetInOrg(ctx, input.datasetId);
      const affectedSourceIds = await ctx.db.transaction(async (tx) => {
        const schema = await lockDatasetSchema(tx, ds.id);
        if (!contractFields(schema).some((f) => f.key === input.key)) throw new TRPCError({ code: 'NOT_FOUND', message: `Field ${input.key} not found` });
        await tx.update(datasets).set({ schema: schema.filter((f) => f.key !== input.key), updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        const locked = await lockSources(tx, ds.id);
        return propagate(tx, locked, input.key, null);
      });
      return { key: input.key, affectedSourceIds };
    }),

  /** "Verified on n of m websites" per field, for the project home (spec 5.3). */
  fieldStatus: publicProcedure
    .input(z.object({ datasetId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ds = await loadDatasetInOrg(ctx, input.datasetId);
      const contract = contractFields(ds.schema);
      const perSource = await Promise.all(ds.sources.map(async (s) => ({ s, currentKeys: new Set((await loadFieldCurrency(ctx.db, s.id)).currentKeys) })));
      const out: Record<string, { verified: number; total: number; websites: Array<{ sourceId: string; slug: string; name: string; verified: boolean }> }> = {};
      for (const f of contract) {
        const websites = perSource.map(({ s, currentKeys }) => ({ sourceId: s.id, slug: s.slug, name: s.name, verified: currentKeys.has(f.key) }));
        out[f.key] = { verified: websites.filter((w) => w.verified).length, total: websites.length, websites };
      }
      return out;
    }),

  /** The Variants setting, every field's effective level, and the project's axes (spec 2026-10-01 §2). */
  variants: publicProcedure
    .input(z.object({ datasetId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ds = await loadDatasetInOrg(ctx, input.datasetId);
      const fields = contractFields(ds.schema).map((f) => ({
        key: f.key,
        name: f.name,
        level: effectiveLevel(f),
        levelIsDefault: f.level === undefined,
      }));
      return { mode: (ds.variantMode as VariantMode) ?? 'ignore', fields, axes: contractAxes(ds.schema) };
    }),

  /** Never deletes axes, levels or website setups (Review Focus 2, spec 2026-10-01 §2). */
  setVariantMode: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), mode: z.enum(['ignore', 'row_per_variant', 'nested']) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDatasetInOrg(ctx, input.datasetId);
      await ctx.db.update(datasets).set({ variantMode: input.mode, updatedAt: new Date() }).where(eq(datasets.id, ds.id));
      return { mode: input.mode as VariantMode };
    }),

  /**
   * `level: null` resets the field to its default-by-concept (`effectiveLevel`).
   * Never touches a website's binding or verification set: `level` lives only
   * on the dataset's contract field and plays no part in `fieldHash`, so a
   * verified field's currency is untouched by this (constraints, ruling 5).
   */
  setFieldLevel: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), key: z.string().min(1), level: z.enum(['product', 'variant']).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDatasetInOrg(ctx, input.datasetId);
      return ctx.db.transaction(async (tx) => {
        const schema = await lockDatasetSchema(tx, ds.id);
        const field = contractFields(schema).find((f) => f.key === input.key);
        if (!field) throw new TRPCError({ code: 'NOT_FOUND', message: `Field ${input.key} not found` });
        const nextSchema = schema.map((f) => {
          if (f.key !== input.key) return f;
          if (input.level === null) {
            const { level: _drop, ...rest } = f as Record<string, unknown>;
            return rest;
          }
          return { ...f, level: input.level };
        });
        await tx.update(datasets).set({ schema: nextSchema, updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        const level: FieldLevel = input.level ?? effectiveLevel(field);
        return { key: input.key, level };
      });
    }),

  /** Spec 2026-10-01 §2: a new axis column; `key` via `deriveKey`, name free among fields and axes. */
  addAxis: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDatasetInOrg(ctx, input.datasetId);
      return ctx.db.transaction((tx) => createAxis(tx, ds.id, input.name));
    }),

  renameAxis: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), key: z.string().min(1), name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDatasetInOrg(ctx, input.datasetId);
      return ctx.db.transaction(async (tx) => {
        const schema = await lockDatasetSchema(tx, ds.id);
        const contract = contractFields(schema);
        const axes = contractAxes(schema);
        if (!axes.some((a) => a.key === input.key)) throw new TRPCError({ code: 'NOT_FOUND', message: `Axis ${input.key} not found` });
        assertNameFree(contract, axes, input.name, input.key);
        await tx.update(datasets).set({ schema: schema.map((f) => (f.key === input.key ? { ...f, name: input.name } : f)), updatedAt: new Date() }).where(eq(datasets.id, ds.id));
        const axis: ContractAxis = { key: input.key, name: input.name, kind: 'axis', concept: 'axis' };
        return axis;
      });
    }),

  /**
   * Refused while any website's `variantSetup` maps to this axis (spec 2026-10-01 §3),
   * naming the website. Both the axis's existence and the in-use check are re-derived
   * from row-locked reads taken inside the transaction — not the pre-transaction
   * `ds`/`ds.sources` snapshot — so a `setVariantSetup` call (Task 5) that maps a
   * website to this axis between this call's dispatch and its write cannot race past
   * the refusal: it either commits its mapping first and this call then sees it under
   * lock, or it blocks on `lockSources` until this transaction (and its delete) commits.
   */
  deleteAxis: publicProcedure
    .input(z.object({ datasetId: z.string().uuid(), key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ds = await loadDatasetInOrg(ctx, input.datasetId);
      await ctx.db.transaction(async (tx) => {
        const schema = await lockDatasetSchema(tx, ds.id);
        const axis = contractAxes(schema).find((a) => a.key === input.key);
        if (!axis) throw new TRPCError({ code: 'NOT_FOUND', message: `Axis ${input.key} not found` });
        const locked = await lockSources(tx, ds.id);
        for (const s of locked) {
          const setup = s.variantSetup as VariantSetup | null;
          if (setup?.axes.some((m) => m.axisKey === input.key)) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `${s.name} uses ${axis.name}` });
          }
        }
        await tx.update(datasets).set({ schema: schema.filter((f) => f.key !== input.key), updatedAt: new Date() }).where(eq(datasets.id, ds.id));
      });
      return { ok: true as const };
    }),
});
