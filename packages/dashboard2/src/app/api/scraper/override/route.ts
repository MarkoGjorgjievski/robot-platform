import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { sourceId, domain, pageType, fields } = await request.json();

    if (!sourceId || !domain || !fields) {
      return NextResponse.json({ error: 'sourceId, domain, and fields are required' }, { status: 400 });
    }

    const { db, sources, collections, domainIntelligence } = await import('@robot/db');
    const { eq, and } = await import('drizzle-orm');

    // 1. Update source's selectors with human overrides
    const humanSelectors = fields
      .filter((f: { xpath?: string; apiPath?: string; source?: string }) => f.xpath || f.apiPath)
      .map((f: { name: string; xpath?: string; attribute?: string; transform?: string }) => ({
        name: f.name,
        xpath: f.xpath ?? '',
        attribute: 'textContent',
        transform: 'trim',
      }));

    await db
      .update(sources)
      .set({
        selectorsJson: { fields: humanSelectors },
        updatedAt: new Date(),
      })
      .where(eq(sources.id, sourceId));

    // 2. Update collection schema with any new fields
    const source = await db.query.sources.findFirst({
      where: eq(sources.id, sourceId),
    });

    if (source) {
      await db
        .update(collections)
        .set({
          schema: fields.map((f: { name: string; type: string; description?: string; required?: boolean }) => ({
            name: f.name,
            type: f.type,
            description: f.description,
            required: f.required,
          })),
          updatedAt: new Date(),
        })
        .where(eq(collections.id, source.collectionId));
    }

    // 3. Save human overrides to GLOBAL domain intelligence cache
    const humanFields = fields.filter(
      (f: { source?: string; xpath?: string; apiPath?: string }) => f.source === 'human' && (f.xpath || f.apiPath)
    );

    if (humanFields.length > 0) {
      const existing = await db.query.domainIntelligence.findFirst({
        where: and(
          eq(domainIntelligence.domain, domain),
          eq(domainIntelligence.pageType, pageType),
        ),
      });

      const now = new Date().toISOString();
      const existingPaths = (existing?.fieldPaths ?? {}) as Record<string, {
        paths: Array<{ path: string; source: string; confidence: number; hits: number; misses: number; lastValue: unknown; lastUsedAt: string }>;
        conflictCount: number;
      }>;

      // Merge human paths — they get highest priority
      for (const field of humanFields) {
        const fieldName = field.name as string;
        if (!existingPaths[fieldName]) {
          existingPaths[fieldName] = { paths: [], conflictCount: 0 };
        }

        const pathSet = existingPaths[fieldName];

        // Add XPath if provided
        if (field.xpath) {
          const existingXpath = pathSet.paths.find(
            (p: { source: string; path: string }) => p.source === 'human' && p.path === field.xpath
          );
          if (existingXpath) {
            existingXpath.confidence = 1.0;
            existingXpath.lastUsedAt = now;
          } else {
            // Insert at the beginning — human paths have highest priority
            pathSet.paths.unshift({
              path: field.xpath,
              source: 'human',
              confidence: 1.0,
              hits: 1,
              misses: 0,
              lastValue: null,
              lastUsedAt: now,
            });
          }
        }

        // Add API path if provided
        if (field.apiPath) {
          const existingApi = pathSet.paths.find(
            (p: { source: string; path: string }) => p.source === 'human' && p.path === field.apiPath
          );
          if (existingApi) {
            existingApi.confidence = 1.0;
            existingApi.lastUsedAt = now;
          } else {
            pathSet.paths.unshift({
              path: field.apiPath,
              source: 'human',
              confidence: 1.0,
              hits: 1,
              misses: 0,
              lastValue: null,
              lastUsedAt: now,
            });
          }
        }

        // Keep max 5 paths per field
        if (pathSet.paths.length > 5) {
          pathSet.paths = pathSet.paths.slice(0, 5);
        }
      }

      if (existing) {
        await db
          .update(domainIntelligence)
          .set({
            fieldPaths: existingPaths,
            updatedAt: new Date(),
          })
          .where(eq(domainIntelligence.id, existing.id));
      } else {
        await db.insert(domainIntelligence).values({
          domain,
          pageType,
          fieldPaths: existingPaths,
          totalRuns: 0,
          successfulRuns: 0,
          consecutiveFailures: 0,
        });
      }

      console.log(`[override] Saved ${humanFields.length} human overrides for ${domain}/${pageType} (global cache updated)`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Override error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Override save failed' },
      { status: 500 }
    );
  }
}
