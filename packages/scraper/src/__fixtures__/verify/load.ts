import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { PageCapture } from '@robot/browser';

const DIR = join(dirname(fileURLToPath(import.meta.url)));

export function loadVerifyFixture(set: string, page: string): PageCapture {
  const raw = JSON.parse(readFileSync(join(DIR, set, `${page}.json`), 'utf-8')) as Omit<PageCapture, 'screenshot' | 'screenshotTiles' | 'markdown' | 'title' | 'timestamp'>;
  return { ...raw, markdown: '', title: '', timestamp: 0, screenshot: Buffer.alloc(0), screenshotTiles: [] };
}
export const SHOP_EXAMPLE_URLS = ['https://shop.example/p/1', 'https://shop.example/p/2', 'https://shop.example/p/3'];
export function loadShopExample(): Record<string, PageCapture> {
  return Object.fromEntries(SHOP_EXAMPLE_URLS.map((u, i) => [u, loadVerifyFixture('shop-example', `p${i + 1}`)]));
}
/** A product on the shop's clearance template: the price is NOT where p1–p3 keep it (spec 2026-09-17). */
export const SHOP_EXAMPLE_P4 = 'https://shop.example/p/4';
