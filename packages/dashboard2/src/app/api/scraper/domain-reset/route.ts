import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { domain } = await request.json();
    if (!domain) {
      return NextResponse.json({ error: 'domain is required' }, { status: 400 });
    }

    const { db, domainIntelligence } = await import('@robot/db');
    const { eq } = await import('drizzle-orm');

    await db.delete(domainIntelligence).where(eq(domainIntelligence.domain, domain));

    console.log(`[domain-reset] Cleared cache for ${domain}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Domain reset error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Reset failed' },
      { status: 500 }
    );
  }
}
