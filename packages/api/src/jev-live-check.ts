// Live check for Jev at Verify, in shadow (spec 2026-10-16 §11): re-capture the proof pages of a
// few campaign websites with shadow switched on IN THIS PROCESS ONLY, wait for each page's
// reading, and print what Jev read beside the stored expected values. Writes new proof-page
// captures and their jev_readings rows; changes nothing else. Real TypeSafe requests, ≈ $0.0002 each.
//
//   JEV_SHADOW=1 pnpm --filter @robot/api exec tsx src/jev-live-check.ts ruggable gymshark colourpop kith
// CAPTURES_DIR must be the api-server's folder, or the app shows broken screenshots for these captures.
process.env.CAPTURES_DIR ??= fileURLToPath(new URL('../../api-server/public/captures', import.meta.url));
import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { db, jevReadings, sources } from '@robot/db';
import { jevEnabled } from './verify/jev-reading.js';
import { runProofPageCaptureInSlot, startProofPageCapture } from './verify/proof-page-capture.js';

const PROJECT_SLUG = 'campaign-2-2026-10-11';
const slugs = process.argv.slice(2);
if (!jevEnabled()) { console.error('Run with JEV_SHADOW=1 and TYPESAFE_API_KEY set.'); process.exit(1); }
if (slugs.length === 0) { console.error('Name the website slugs.'); process.exit(1); }

type Set = { urls: string[]; expected?: Record<string, Record<string, string>>; defaults?: Record<string, string> };

for (const slug of slugs) {
  const rows = await db.query.sources.findMany({ where: eq(sources.slug, slug), with: { dataset: { with: { project: true } } } });
  const site = rows.find((r) => (r as { dataset?: { project?: { slug?: string } } }).dataset?.project?.slug === PROJECT_SLUG);
  if (!site) { console.log(`${slug}: not found in ${PROJECT_SLUG}`); continue; }
  const set = site.verificationSet as Set;
  const fields = (site.schemaDefinition ?? []) as Array<{ key: string; name: string }>;
  console.log(`\n== ${slug} (${set.urls.length} proof pages)`);
  const captureIds: string[] = [];
  for (const url of set.urls) {
    const { captureId } = await startProofPageCapture(site.id, url, { fire: false });
    await runProofPageCaptureInSlot(captureId);
    captureIds.push(captureId);
  }
  const deadline = Date.now() + 60_000;
  let readings = await db.select().from(jevReadings).where(inArray(jevReadings.captureId, captureIds));
  while (Date.now() < deadline && (readings.length < captureIds.length || readings.some((r) => r.status === 'running'))) {
    await new Promise((r) => setTimeout(r, 2000));
    readings = await db.select().from(jevReadings).where(and(eq(jevReadings.sourceId, site.id), inArray(jevReadings.captureId, captureIds)));
  }
  for (const id of captureIds) {
    const r = readings.find((x) => x.captureId === id);
    if (!r) { console.log(`  ${id.slice(0, 8)}: no reading (nothing ambiguous to ask, or the budget)`); continue; }
    const url = r.url;
    console.log(`  ${url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}  [${r.status}] tokens ${r.inputTokens ?? 0}, $${Number(r.costUsd ?? 0).toFixed(6)}${r.error ? `  error: ${r.error}` : ''}`);
    const a = r.answers as { fields?: Record<string, { candidates: Array<{ id: string; value: string }>; pick: string; p: number }>; variant?: { entries: Array<{ id: string; label: string }>; pick: string; p: number; pageMatch: string | null } } | null;
    for (const [key, f] of Object.entries(a?.fields ?? {})) {
      const name = fields.find((x) => x.key === key)?.name ?? key;
      const picked = f.pick === 'none' ? 'none' : f.candidates.find((c) => c.id === f.pick)?.value;
      const typed = set.expected?.[key]?.[url] || set.defaults?.[key] || '';
      console.log(`    ${name}: Jev ${JSON.stringify(picked)} (${f.p.toFixed(2)}) of ${f.candidates.length} · expected ${JSON.stringify(typed)}`);
    }
    if (a?.variant) {
      const v = a.variant;
      const lab = (id: string | null) => (id === null ? 'nothing' : id === 'none' ? 'none' : v.entries.find((e) => e.id === id)?.label);
      console.log(`    Variant: Jev ${JSON.stringify(lab(v.pick))} (${v.p.toFixed(2)}) · [page] ${JSON.stringify(lab(v.pageMatch))}`);
    }
  }
}
process.exit(0);
