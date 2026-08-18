// Usage: pnpm --filter @robot/api dogfood
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

// Repo root resolved from this module — portable across machines and OSes.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

try {
  loadEnvFile(join(repoRoot, '.env'));
} catch {
  // .env not present — fall back to whatever is already in process.env
}
process.env.CAPTURES_DIR ??= join(tmpdir(), 'dogfood-captures');

const { db } = await import('@robot/db');
const { scraperRouter } = await import('./routers/scraper.js');
const { judgeFieldExtraction, judgeVariantArray } = await import('@robot/agent');
type JudgeVerdict = Awaited<ReturnType<typeof judgeFieldExtraction>>;
const { liveCorpus } = await import('@robot/scraper');

const caller = scraperRouter.createCaller({ db });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error('ANTHROPIC_API_KEY required'); process.exit(1); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const lines: string[] = [`# Dogfood ${stamp}`, ''];

let totalResolved = 0, totalWrong = 0, totalNotOnPage = 0, totalUnverifiable = 0, totalError = 0, totalAbsent = 0, totalFields = 0;

for (const site of liveCorpus) {
  lines.push(`## ${site.label} — ${site.url}`, '');

  try {
    const analysis = await caller.analyze({ url: site.url });
    const fields = (analysis.schema.fields as Array<{ name: string; type: string; description?: string; tier?: 'requested' | 'discovered'; example_value?: string }>)
      .map((f) => ({ name: f.name, type: f.type, description: f.description, tier: f.tier, example_value: f.example_value }));

    // Ensure variants is requested even when discovery / cache didn't propose it,
    // and force the type to variant_array — a cache hit may have returned the
    // field as 'string' (cache type-inference is heuristic, not authoritative).
    const variantsField = fields.find((f) => f.name === 'variants');
    if (variantsField) {
      variantsField.type = 'variant_array';
    } else {
      fields.push({ name: 'variants', type: 'variant_array', description: 'Product variants (color/size/capacity/etc.)', tier: 'requested' as 'requested' | 'discovered' | undefined, example_value: undefined });
    }

    const result = await caller.extract({ url: site.url, fields, pageType: site.pageType });

    // Screenshot for the judge — extract just wrote one to CAPTURES_DIR (via the cache-miss path or analyze cache-hit).
    // The captureId returned by analyze is the filename stem; if extract recapped, use the one analyze persisted.
    const screenshotPath = analysis.screenshotUrl
      ? join(process.env.CAPTURES_DIR!, analysis.screenshotUrl.replace(/^\/captures\//, ''))
      : null;
    const screenshot = screenshotPath ? readFileSync(screenshotPath) : null;

    lines.push(`Resolved: ${result.fieldCount.found}/${result.fieldCount.total} (${Math.round(result.confidence * 100)}%)`, '');
    totalFields += result.fieldCount.total;

    const rows = [...result.fieldsByTier.requested, ...result.fieldsByTier.discovered];
    for (const row of rows) {
      if (row.value == null) {
        const absent = site.knownAbsentFields?.includes(row.name) ?? false;
        lines.push(`- [${absent ? 'absent' : 'miss'}] ${row.name}: —`);
        if (absent) totalAbsent++;
        continue;
      }
      totalResolved++;

      // Detect variant_array by value shape (the extract response carries source
      // but not type; safe inference: array of plain objects with a 'sku' or
      // 'price' key on at least one entry).
      const isVariantArray = Array.isArray(row.value)
        && row.value.length > 0
        && typeof row.value[0] === 'object'
        && row.value[0] !== null
        && !Array.isArray(row.value[0])
        && (row.value as Array<Record<string, unknown>>).some((v) => 'sku' in v || 'price' in v || 'image_url' in v);

      let verdict: JudgeVerdict;
      if (!screenshot) {
        verdict = 'error';
      } else if (isVariantArray) {
        verdict = await judgeVariantArray({ screenshot, variants: row.value as Array<Record<string, unknown>>, apiKey });
      } else {
        verdict = await judgeFieldExtraction({ screenshot, field: row.name, value: row.value, apiKey });
      }
      if (verdict === 'wrong') totalWrong++;
      if (verdict === 'not-on-page') totalNotOnPage++;
      if (verdict === 'unverifiable') totalUnverifiable++;
      if (verdict === 'error') totalError++;

      // Render: scalars get JSON.stringify truncated to 100; variant arrays get a condensed summary.
      let valStr: string;
      if (isVariantArray) {
        const arr = row.value as Array<Record<string, unknown>>;
        const summary = arr.slice(0, 3).map((v) => {
          const axis = v.color ?? v.size ?? v.capacity ?? v.sku ?? '?';
          return `${axis}${v.price != null ? ` @${v.price}` : ''}`;
        }).join(', ');
        valStr = `${arr.length} variants: [${summary}${arr.length > 3 ? ', ...' : ''}]`;
      } else {
        valStr = String(JSON.stringify(row.value)).slice(0, 100);
      }
      lines.push(`- [${verdict}] ${row.name}: ${valStr} (src=${row.source})`);
    }
    lines.push('');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`- [error] site processing failed: ${msg}`);
    lines.push('');
    continue;
  }
}

lines.push('## Aggregate', '');
lines.push(`- Total fields requested: ${totalFields}`);
lines.push(`- Resolved: ${totalResolved}`);
lines.push(`- Resolved but wrong: ${totalWrong}`);
lines.push(`- Resolved but not on page: ${totalNotOnPage}`);
lines.push(`- Resolved but not confirmable from a screenshot (URLs, IDs, metadata): ${totalUnverifiable}`);
lines.push(`- Judge failed to return a verdict (error / no screenshot): ${totalError}`);
lines.push(`- Legitimately absent: ${totalAbsent}`);

const outDir = join(repoRoot, 'docs', 'testing', 'results');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${stamp}-dogfood.md`);
writeFileSync(outPath, lines.join('\n'));
console.log(`wrote ${outPath}`);
process.exit(0);
