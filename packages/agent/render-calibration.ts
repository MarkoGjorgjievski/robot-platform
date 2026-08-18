// Regenerates the judge-calibration screenshot from its HTML source.
// Usage: pnpm --filter @robot/agent render:calibration
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'src', '__fixtures__', 'judge-calibration');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
await page.setContent(readFileSync(join(dir, 'page.html'), 'utf-8'));
writeFileSync(join(dir, 'page.png'), await page.screenshot());
await browser.close();
console.log('wrote', join(dir, 'page.png'));
