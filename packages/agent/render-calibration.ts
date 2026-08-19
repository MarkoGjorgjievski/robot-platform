// Regenerates the judge-calibration screenshots from their HTML sources.
// Usage: pnpm --filter @robot/agent render:calibration
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'src', '__fixtures__', 'judge-calibration');
const PAGES: Array<[string, { width: number; height: number }]> = [
  ['page', { width: 800, height: 400 }],
  ['variants-page', { width: 800, height: 480 }],
];

const browser = await chromium.launch();
for (const [name, viewport] of PAGES) {
  const page = await browser.newPage({ viewport });
  await page.setContent(readFileSync(join(dir, `${name}.html`), 'utf-8'));
  writeFileSync(join(dir, `${name}.png`), await page.screenshot());
  await page.close();
  console.log('wrote', join(dir, `${name}.png`));
}
await browser.close();
