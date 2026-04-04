import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { orgId, name, url, pageType, fields, plan, data } = await request.json();

    if (!orgId || !name || !url) {
      return NextResponse.json({ error: 'orgId, name, and url are required' }, { status: 400 });
    }

    const { db, projects, collections, sources, captures, extractions } = await import('@robot/db');
    const { eq } = await import('drizzle-orm');

    // 1. Find or create a default project for this org
    const existingProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.orgId, orgId))
      .limit(1);

    let projectId: string;
    if (existingProjects.length > 0) {
      projectId = existingProjects[0].id;
    } else {
      const [project] = await db
        .insert(projects)
        .values({
          orgId,
          name: 'Default',
          slug: 'default',
          description: 'Default project',
        })
        .returning();
      projectId = project.id;
    }

    // 2. Create collection (schema) with the fields
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + Date.now().toString(36);

    const [collection] = await db
      .insert(collections)
      .values({
        projectId,
        name,
        slug,
        description: `Schema for ${name}`,
        schema: fields,
      })
      .returning();

    // 3. Create the source
    const domain = new URL(url).hostname;

    const [source] = await db
      .insert(sources)
      .values({
        collectionId: collection.id,
        name,
        slug: slug + '-source',
        country: 'US',
        sourceType: pageType === 'detail' ? 'detail' : 'listing',
        urlPattern: url,
        selectorsJson: plan,
        aiStatus: 'ready',
      })
      .returning();

    // 4. Save initial extraction data (if we have it from the wizard preview)
    if (data && Array.isArray(data) && data.length > 0) {
      const [capture] = await db
        .insert(captures)
        .values({
          sourceId: source.id,
          url,
          metadata: { pageType, savedFromWizard: true },
        })
        .returning();

      await db.insert(extractions).values({
        sourceId: source.id,
        captureId: capture.id,
        data,
        rowCount: data.length,
        confidence: Math.round((fields.length > 0 ? Object.keys(data[0] ?? {}).length / fields.length : 0) * 100),
      });

      console.log(`[save] Saved ${data.length} rows of extraction data`);
    }

    console.log(`[save] Created source ${source.id} for ${domain} (${pageType})`);

    return NextResponse.json({
      sourceId: source.id,
      collectionId: collection.id,
      projectId,
    });
  } catch (err) {
    console.error('Save error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Save failed' },
      { status: 500 }
    );
  }
}
