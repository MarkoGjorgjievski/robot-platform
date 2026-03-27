import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Dynamic imports to avoid webpack bundling playwright
    const { PlaywrightBrowser } = await import('@robot/browser');
    const { SchemaAgent } = await import('@robot/agent');

    // 1. Capture the page
    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });

    let capture;
    try {
      capture = await browser.capture(url, { waitUntil: 'networkidle' });
    } finally {
      await browser.close();
    }

    // 2. Save screenshot
    const screenshotId = randomUUID();
    const screenshotFilename = `${screenshotId}.png`;
    const screenshotPath = join(process.cwd(), 'public', 'captures', screenshotFilename);
    await writeFile(screenshotPath, capture.screenshot);

    // 3. Log intercepted APIs
    if (capture.interceptedRequests.length > 0) {
      console.log(`[analyze] Intercepted ${capture.interceptedRequests.length} API responses:`);
      for (const req of capture.interceptedRequests.slice(0, 5)) {
        console.log(`  - ${req.method} ${req.url.slice(0, 100)} (${req.bodySize} bytes)`);
      }
    }

    // 4. Discover schema
    const agent = new SchemaAgent();
    const schema = await agent.discoverSchema(capture);

    return NextResponse.json({
      captureId: screenshotId,
      screenshotUrl: `/captures/${screenshotFilename}`,
      url: capture.url,
      title: capture.title,
      schema,
    });
  } catch (err) {
    console.error('Analyze error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
