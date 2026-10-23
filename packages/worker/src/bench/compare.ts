// Same values? Compares two benchmark results page by page and field by field (data and shown flags) on every page
// both have. Exit 1 on any difference.
//   cd packages/worker && npx tsx src/bench/compare.ts ../../docs/testing/results/2026-10-23-run-speed/before.json ../../docs/testing/results/2026-10-23-run-speed/after-1.json
import { readFileSync } from 'node:fs';

type Values = Record<string, { data: Record<string, unknown>; shown: Record<string, unknown> }>;
const [fa, fb] = process.argv.slice(2);
if (!fa || !fb) { console.error('usage: compare.ts <a.json> <b.json>'); process.exit(2); }
const A = (JSON.parse(readFileSync(fa, 'utf8')) as { values: Values }).values;
const B = (JSON.parse(readFileSync(fb, 'utf8')) as { values: Values }).values;
const pages = Object.keys(A).filter((p) => p in B);
const diffs: string[] = [];
for (const p of pages) {
  for (const part of ['data', 'shown'] as const) {
    for (const f of new Set([...Object.keys(A[p]![part]), ...Object.keys(B[p]![part])])) {
      const x = JSON.stringify(A[p]![part][f] ?? null); const y = JSON.stringify(B[p]![part][f] ?? null);
      if (x !== y) diffs.push(`${p} ${part}.${f}: ${x} → ${y}`);
    }
  }
}
console.log(`${pages.length} pages in both; ${diffs.length} difference(s)`);
for (const d of diffs.slice(0, 50)) console.log(`  ${d}`);
process.exit(diffs.length === 0 && pages.length > 0 ? 0 : 1);
