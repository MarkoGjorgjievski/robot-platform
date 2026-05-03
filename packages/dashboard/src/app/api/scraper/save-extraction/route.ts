import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { url, extractedData, fields, confidence, sources } = await request.json();

    if (!url || !extractedData) {
      return NextResponse.json({ error: 'url and extractedData are required' }, { status: 400 });
    }

    const { db, quickExtractions } = await import('@robot/db');

    const domain = new URL(url).hostname.replace(/^www\./, '');

    const [extraction] = await db
      .insert(quickExtractions)
      .values({
        url,
        domain,
        extractedData,
        fields: fields ?? [],
        confidence: confidence != null ? Math.round(confidence * 100) : null,
        sources: sources ?? {},
      })
      .returning();

    console.log(`[save-extraction] Saved extraction ${extraction.id} for ${domain}`);

    return NextResponse.json({ id: extraction.id });
  } catch (err) {
    console.error('Save extraction error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Save failed' },
      { status: 500 }
    );
  }
}
