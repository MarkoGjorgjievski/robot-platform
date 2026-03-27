import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { orgId, name, url, pageType, fields, plan, data } = await request.json();

    if (!orgId || !name || !url) {
      return NextResponse.json({ error: 'orgId, name, and url are required' }, { status: 400 });
    }

    // Use the tRPC server caller for consistency
    const { appRouter } = await import('@robot/api');
    const { db } = await import('@robot/db');
    const api = appRouter.createCaller({ db });

    // 1. Find or create a default project for this org
    const existingProjects = await api.projects.listByOrg({ orgId });
    let projectId: string;

    if (existingProjects.length > 0) {
      projectId = existingProjects[0].id;
    } else {
      const project = await api.projects.create({
        orgId,
        name: 'Default',
        slug: 'default',
        description: 'Default project',
      });
      projectId = project.id;
    }

    // 2. Create collection (schema) with the fields
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);

    const collection = await api.collections.create({
      projectId,
      name: `${name}`,
      slug: `${slug}-schema`,
      schema: fields,
    });

    // 3. Create the source
    const source = await api.sources.create({
      collectionId: collection.id,
      name,
      slug,
      country: 'US',
    });

    // 4. Update source with AI fields (these aren't in the tRPC create input)
    const { sources: sourcesTable } = await import('@robot/db');
    const { eq } = await import('drizzle-orm');
    await db
      .update(sourcesTable)
      .set({
        sourceType: pageType === 'detail' ? 'detail' : 'listing',
        urlPattern: url,
        selectorsJson: plan,
        aiStatus: 'ready',
      })
      .where(eq(sourcesTable.id, source.id));

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
