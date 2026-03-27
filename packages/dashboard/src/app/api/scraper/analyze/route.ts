import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // TODO: Wire up to @robot/scraper pipeline
    // For now, return a mock response to test the UI flow
    return NextResponse.json({
      screenshotUrl: null,
      schema: {
        page_type: 'listing',
        description: 'Mock analysis - scraper pipeline not connected yet',
        fields: [
          { name: 'title', type: 'string', description: 'Page title', required: true, example_value: 'Example Item' },
          { name: 'url', type: 'url', description: 'Item link', required: true, example_value: 'https://example.com/item' },
          { name: 'description', type: 'string', description: 'Item description', required: false, example_value: 'A sample description' },
        ],
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
