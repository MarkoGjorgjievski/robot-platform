import { NextResponse } from 'next/server';

// The quick_extractions table was retired in migration 0008. Saving via this
// endpoint is a no-op until the v1.5 redesign wires extractions through the
// Sandbox sources/runs/captures pipeline. Existing callers (extraction-wizard)
// receive a synthetic id so the UI flow continues to work.
export async function POST() {
  return NextResponse.json({ id: null, deprecated: true });
}
