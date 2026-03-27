import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { url, fields } = await request.json();

    if (!url || !fields) {
      return NextResponse.json({ error: 'URL and fields are required' }, { status: 400 });
    }

    // TODO: Wire up to @robot/scraper pipeline
    // For now, return mock data to test the UI flow
    const mockData = Array.from({ length: 5 }, (_, i) => {
      const row: Record<string, string> = {};
      for (const field of fields) {
        row[field.name] = `Sample ${field.name} ${i + 1}`;
      }
      return row;
    });

    return NextResponse.json({
      data: mockData,
      confidence: 0.85,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Extraction failed' },
      { status: 500 }
    );
  }
}
