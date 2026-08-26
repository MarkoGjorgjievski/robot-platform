import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, desc, and } from 'drizzle-orm';
import { router, publicProcedure } from '../trpc';
import { db, sources, projects, orgs, datasets, inputSets, runs, captures, extractions } from '@robot/db';
import { scraperRouter } from './scraper';

// ─── Helpers ────────────────────────────────────────────────────────────────

const SANDBOX_SLUG = 'scratch';

function slugifyDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shortRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function getSandboxProjectId(): Promise<string> {
  const allOrgs = await db.select().from(orgs).orderBy(orgs.createdAt).limit(1);
  if (allOrgs.length === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No orgs found. Run `pnpm --filter @robot/db seed:sandbox` first.',
    });
  }
  const sandbox = await db.query.projects.findFirst({
    where: and(eq(projects.orgId, allOrgs[0].id), eq(projects.slug, SANDBOX_SLUG)),
  });
  if (!sandbox) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `No Sandbox project for org ${allOrgs[0].slug}. Run seed:sandbox first.`,
    });
  }
  return sandbox.id;
}

// ─── Procedures ─────────────────────────────────────────────────────────────

export const sandboxRouter = router({
  /**
   * Create a draft Sandbox Source from a URL.
   * Returns { slug } so the client can immediately navigate to /sandbox/{slug}.
   */
  create: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
        requestedFields: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { url, requestedFields } = input;
      const parsedUrl = new URL(url);
      const domain = parsedUrl.hostname.replace(/^www\./, '');
      const sandboxProjectId = await getSandboxProjectId();

      const [createdInputSet] = await db
        .insert(inputSets)
        .values({
          projectId: sandboxProjectId,
          type: 'direct',
          name: `inline:${url}`,
          columns: [{ name: 'url', primary: true, type: 'string' }],
          rows: [{ url }],
          isInline: true,
        })
        .returning({ id: inputSets.id });

      const pathSegment = parsedUrl.pathname && parsedUrl.pathname !== '/' ? ` ${parsedUrl.pathname}` : '';
      const slug = `${slugifyDomain(domain)}-${shortRandomSuffix()}`;
      const [createdSource] = await db
        .insert(sources)
        .values({
          name: `${domain}${pathSegment}`,
          slug,
          country: 'us',
          sourceType: 'sandbox',
          isSandbox: true,
          inputStrategy: 'direct',
          urlTemplate: url,
          listingMode: 'detail',
          inputSetId: createdInputSet.id,
          datasetId: null,
          selectorsJson: requestedFields ? { requestedFields } : null,
        })
        .returning({ slug: sources.slug });

      return { slug: createdSource.slug };
    }),

  /**
   * List recent Sandbox Sources for the /sandbox index page.
   */
  list: publicProcedure.query(async () => {
    const rows = await db
      .select({
        slug: sources.slug,
        name: sources.name,
        urlTemplate: sources.urlTemplate,
        createdAt: sources.createdAt,
        updatedAt: sources.updatedAt,
      })
      .from(sources)
      .where(eq(sources.isSandbox, true))
      .orderBy(desc(sources.updatedAt))
      .limit(50);

    return rows;
  }),

  /**
   * Load full state for the wizard at /sandbox/{slug}.
   * Returns null if the slug doesn't match a Sandbox Source.
   */
  get: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const source = await db.query.sources.findFirst({
        where: and(eq(sources.slug, input.slug), eq(sources.isSandbox, true)),
      });
      if (!source) return null;

      const latestRun = await db
        .select()
        .from(runs)
        .where(eq(runs.sourceId, source.id))
        .orderBy(desc(runs.createdAt))
        .limit(1)
        .then((r) => r[0] ?? null);

      const latestExtraction = latestRun
        ? await db
            .select()
            .from(extractions)
            .where(eq(extractions.runId, latestRun.id))
            .orderBy(desc(extractions.createdAt))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null;

      const latestCapture = latestRun
        ? await db
            .select()
            .from(captures)
            .where(eq(captures.runId, latestRun.id))
            .orderBy(desc(captures.createdAt))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null;

      return {
        source: {
          id: source.id,
          slug: source.slug,
          name: source.name,
          urlTemplate: source.urlTemplate,
          selectorsJson: source.selectorsJson,
          isSandbox: source.isSandbox,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt,
        },
        latestRun: latestRun
          ? {
              id: latestRun.id,
              status: latestRun.status,
              startedAt: latestRun.startedAt,
              completedAt: latestRun.completedAt,
              errorMessage: latestRun.errorMessage,
              resultCount: latestRun.resultCount,
            }
          : null,
        latestExtraction: latestExtraction
          ? {
              data: latestExtraction.data,
              confidence: latestExtraction.confidence,
              validationResult: latestExtraction.validationResult,
            }
          : null,
        latestCapture: latestCapture
          ? {
              screenshotPath: latestCapture.screenshotPath,
            }
          : null,
      };
    }),

  /**
   * Run schema discovery on the Source's URL.
   * Writes the resulting schema to sources.selectors_json.
   * Idempotent: returns cached schema unless force=true.
   */
  analyze: publicProcedure
    .input(z.object({ slug: z.string(), force: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const source = await db.query.sources.findFirst({
        where: and(eq(sources.slug, input.slug), eq(sources.isSandbox, true)),
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Sandbox source not found: ${input.slug}` });
      }
      if (!source.urlTemplate) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Source has no URL' });
      }

      const existing = source.selectorsJson as { fields?: unknown[]; schema?: unknown; requestedFields?: string } | null;
      if (!input.force && existing && Array.isArray(existing.fields) && existing.fields.length > 0) {
        return existing;
      }

      const requestedFields = existing && typeof existing === 'object' ? existing.requestedFields : undefined;

      const scraperCaller = scraperRouter.createCaller(ctx);
      const result = await scraperCaller.analyze({ url: source.urlTemplate, requestedFields });

      const schemaPayload = {
        fields: result.schema.fields,
        pageType: result.schema.page_type,
        cached: result.cached,
        // False = the capture failed: examples (and, on dual-cache domains,
        // even the page type) come from earlier runs, not this URL. The wizard
        // must warn rather than present them as current (2026-08-26 incident).
        liveExamples: result.liveExamples,
        // Set when the site served a bot-check/error interstitial instead of
        // the page — the wizard names it (second 2026-08-26 incident).
        blockedReason: result.blockedReason ?? null,
        captureId: result.captureId,
        screenshotUrl: result.screenshotUrl,
      };
      await db
        .update(sources)
        .set({ selectorsJson: schemaPayload, updatedAt: new Date() })
        .where(eq(sources.id, source.id));

      return schemaPayload;
    }),

  /**
   * Run extraction: save current field selection, run scraper.extract,
   * persist Run + Capture + Extraction rows.
   */
  extract: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        fields: z.array(
          z.object({
            name: z.string().min(1),
            type: z.string().min(1),
            description: z.string().optional(),
            tier: z.enum(['requested', 'discovered']).optional(),
            source: z.string().optional(),
            api_path: z.string().optional(),
            enabled: z.boolean().optional(),
            example_value: z.string().optional(),
          })
        ).min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const source = await db.query.sources.findFirst({
        where: and(eq(sources.slug, input.slug), eq(sources.isSandbox, true)),
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Sandbox source not found: ${input.slug}` });
      }
      if (!source.urlTemplate) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Source has no URL' });
      }

      const existing = (source.selectorsJson as {
        pageType?: string;
        screenshotUrl?: string;
      } | null) ?? null;
      const updatedSchema = { ...(existing ?? {}), fields: input.fields };
      await db
        .update(sources)
        .set({ selectorsJson: updatedSchema, updatedAt: new Date() })
        .where(eq(sources.id, source.id));

      const [run] = await db
        .insert(runs)
        .values({
          sourceId: source.id,
          status: 'running',
          startedAt: new Date(),
          inputLabel: source.urlTemplate.slice(0, 200),
        })
        .returning({ id: runs.id });

      try {
        const enabledFields = input.fields.filter((f) => f.enabled !== false);

        const scraperCaller = scraperRouter.createCaller(ctx);
        const result = await scraperCaller.extract({
          url: source.urlTemplate,
          fields: enabledFields,
          pageType: (existing?.pageType === 'listing' ? 'listing' : 'detail') as 'listing' | 'detail',
        });

        const screenshotPath = existing && typeof existing === 'object' && existing.screenshotUrl
          ? existing.screenshotUrl
          : null;

        const [capture] = await db
          .insert(captures)
          .values({
            sourceId: source.id,
            runId: run.id,
            url: source.urlTemplate,
            html: null,
            markdown: null,
            screenshotPath,
            metadata: {},
          })
          .returning({ id: captures.id });

        await db.insert(extractions).values({
          sourceId: source.id,
          captureId: capture.id,
          runId: run.id,
          data: result.data,
          rowCount: Array.isArray(result.data) ? result.data.length : 0,
          confidence: Math.round((result.confidence ?? 0) * 100),
          validationResult: result.qualityIssues ?? null,
        });

        await db
          .update(runs)
          .set({
            status: 'completed',
            completedAt: new Date(),
            resultCount: Array.isArray(result.data) ? result.data.length : 0,
          })
          .where(eq(runs.id, run.id));

        await db
          .update(sources)
          .set({ updatedAt: new Date() })
          .where(eq(sources.id, source.id));

        return { runId: run.id, ...result };
      } catch (err) {
        await db
          .update(runs)
          .set({
            status: 'failed',
            completedAt: new Date(),
            errorMessage: err instanceof Error ? err.message : 'Extraction failed',
          })
          .where(eq(runs.id, run.id));

        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'Extraction failed',
        });
      }
    }),

  /**
   * Delete a Sandbox Source by slug.
   * Also deletes the linked InputSet if it was created inline by sandbox.create.
   */
  delete: publicProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      const source = await db.query.sources.findFirst({
        where: and(eq(sources.slug, input.slug), eq(sources.isSandbox, true)),
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Sandbox source not found: ${input.slug}` });
      }

      const inputSetId = source.inputSetId;
      await db.delete(sources).where(eq(sources.id, source.id));

      // If the linked InputSet was inline (created by sandbox.create), delete it too.
      if (inputSetId) {
        const inputSet = await db.query.inputSets.findFirst({
          where: eq(inputSets.id, inputSetId),
        });
        if (inputSet && inputSet.isInline) {
          await db.delete(inputSets).where(eq(inputSets.id, inputSetId));
        }
      }

      return { deletedSlug: input.slug };
    }),

  /**
   * Graduate a Sandbox Source: move it from the Sandbox project into a real
   * Project + Dataset, optionally promoting its inline InputSet to a named one.
   * All operations occur inside a single Drizzle transaction.
   */
  graduate: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        project: z.discriminatedUnion('mode', [
          z.object({ mode: z.literal('existing'), existingSlug: z.string().min(1) }),
          z.object({
            mode: z.literal('new'),
            newName: z.string().min(1).max(255),
            newSlug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
          }),
        ]),
        dataset: z.discriminatedUnion('mode', [
          z.object({ mode: z.literal('existing'), existingSlug: z.string().min(1) }),
          z.object({
            mode: z.literal('new'),
            newName: z.string().min(1).max(255),
            newSlug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
          }),
        ]),
        source: z.object({
          name: z.string().min(1).max(255),
          slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
        }),
        promoteInputSet: z
          .object({
            name: z.string().min(1).max(255),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const sandboxSource = await db.query.sources.findFirst({
        where: and(eq(sources.slug, input.slug), eq(sources.isSandbox, true)),
      });
      if (!sandboxSource) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Sandbox source not found: ${input.slug}` });
      }

      // Pick the default org for graduation
      const orgRow = await db.select().from(orgs).orderBy(orgs.createdAt).limit(1);
      if (orgRow.length === 0) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No orgs found' });
      }
      const orgId = orgRow[0].id;

      // Schema for the new dataset (if needed) — auto-derive from sandbox source's fields
      const sandboxSchema = (sandboxSource.selectorsJson as { fields?: Array<Record<string, unknown>> } | null) ?? null;
      const derivedDatasetSchema = (sandboxSchema?.fields ?? []).map((f) => ({
        ...f,
        source: (f as { source?: string }).source ?? 'detail',
      }));

      return await db.transaction(async (tx) => {
        // Step 1: resolve Project
        let projectId: string;
        let projectSlug: string;
        if (input.project.mode === 'existing') {
          const existing = await tx.query.projects.findFirst({
            where: and(eq(projects.orgId, orgId), eq(projects.slug, input.project.existingSlug)),
          });
          if (!existing) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: `Project not found: ${input.project.existingSlug}`,
            });
          }
          if (existing.slug === SANDBOX_SLUG) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot graduate into the Sandbox project',
            });
          }
          projectId = existing.id;
          projectSlug = existing.slug;
        } else {
          // Reject reserved slug
          if (input.project.newSlug === SANDBOX_SLUG) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot use "scratch" as a project slug',
            });
          }
          // Check slug collision
          const collision = await tx.query.projects.findFirst({
            where: and(eq(projects.orgId, orgId), eq(projects.slug, input.project.newSlug)),
          });
          if (collision) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `Project slug "${input.project.newSlug}" already exists in this org`,
            });
          }
          const [created] = await tx
            .insert(projects)
            .values({
              orgId,
              name: input.project.newName,
              slug: input.project.newSlug,
            })
            .returning({ id: projects.id, slug: projects.slug });
          projectId = created.id;
          projectSlug = created.slug;
        }

        // Step 2: resolve Dataset
        let datasetId: string;
        if (input.dataset.mode === 'existing') {
          const existing = await tx.query.datasets.findFirst({
            where: and(eq(datasets.projectId, projectId), eq(datasets.slug, input.dataset.existingSlug)),
          });
          if (!existing) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: `Dataset not found in project: ${input.dataset.existingSlug}`,
            });
          }
          datasetId = existing.id;
        } else {
          const collision = await tx.query.datasets.findFirst({
            where: and(eq(datasets.projectId, projectId), eq(datasets.slug, input.dataset.newSlug)),
          });
          if (collision) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `Dataset slug "${input.dataset.newSlug}" already exists in this project`,
            });
          }
          const [created] = await tx
            .insert(datasets)
            .values({
              projectId,
              name: input.dataset.newName,
              slug: input.dataset.newSlug,
              schema: derivedDatasetSchema,
            })
            .returning({ id: datasets.id });
          datasetId = created.id;
        }

        // Step 3: validate source slug doesn't collide within the new dataset
        const sourceCollision = await tx.query.sources.findFirst({
          where: and(eq(sources.datasetId, datasetId), eq(sources.slug, input.source.slug)),
        });
        if (sourceCollision) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Source slug "${input.source.slug}" already exists in this dataset`,
          });
        }

        // Step 4: update the Source
        await tx
          .update(sources)
          .set({
            isSandbox: false,
            datasetId,
            name: input.source.name,
            slug: input.source.slug,
            updatedAt: new Date(),
          })
          .where(eq(sources.id, sandboxSource.id));

        // Step 5: optionally promote the inline InputSet
        if (input.promoteInputSet && sandboxSource.inputSetId) {
          await tx
            .update(inputSets)
            .set({
              isInline: false,
              name: input.promoteInputSet.name,
              projectId: projectId,
              updatedAt: new Date(),
            })
            .where(eq(inputSets.id, sandboxSource.inputSetId));
        }

        return { projectSlug, sourceSlug: input.source.slug };
      });
    }),
});
