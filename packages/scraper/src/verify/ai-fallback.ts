import type { ProposePathsAgent } from '@robot/agent';
import { visibleTextFromHtml } from '../corroborate-value.js';
import type { CandidatePath, CaptureLike } from './certify.js';
import type { SchemaDefinitionField } from './types.js';

export type FallbackEvidence = {
  field: SchemaDefinitionField;
  expected: Record<string, string>;
  captures: Record<string, CaptureLike | null>;
  nearMisses: Record<string, string[]>;
};

const PER_BODY_CHARS = 8_000;
const API_SECTION_CHARS = 20_000;
const TEXT_WINDOW = 400;
const TEXT_SECTION_CHARS = 6_000;

function apiSection(capture: CaptureLike): string {
  let spent = 0;
  const parts: string[] = [];
  for (const r of capture.interceptedRequests) {
    if (!r.isJson || r.parsedJson === null) continue;
    const s = JSON.stringify(r.parsedJson);
    if (s.length > PER_BODY_CHARS || spent + s.length > API_SECTION_CHARS) { parts.push(`[body ${r.url} omitted: ${s.length} chars]`); continue; }
    parts.push(`[body ${r.url}]\n${s}`);
    spent += s.length;
  }
  return parts.join('\n');
}

function textWindows(html: string, expected: string): string {
  const text = visibleTextFromHtml(html);
  const idx = text.toLowerCase().indexOf(expected.toLowerCase());
  if (idx === -1) return text.slice(0, TEXT_SECTION_CHARS);
  return text.slice(Math.max(0, idx - TEXT_WINDOW), Math.min(text.length, idx + expected.length + TEXT_WINDOW));
}

export function buildProposePrompt(e: FallbackEvidence): string {
  const lines: string[] = [];
  lines.push(`FIELD: ${e.field.name} (key ${e.field.key}, type ${e.field.type})`);
  lines.push(`DESCRIPTION: ${e.field.description}`);
  lines.push('EXPECTED VALUE PER PAGE:');
  for (const [url, v] of Object.entries(e.expected)) lines.push(`- ${url} → ${v}`);
  for (const [url, capture] of Object.entries(e.captures)) {
    if (!capture) continue;
    lines.push(`\n=== PAGE ${url} ===`);
    const misses = e.nearMisses[url] ?? [];
    if (misses.length) lines.push(`Near-misses we found but which did not certify: ${misses.join(' | ')}`);
    lines.push(`--- intercepted JSON ---\n${apiSection(capture)}`);
    lines.push(`--- json-ld ---\n${JSON.stringify(capture.structuredData.ldJson).slice(0, PER_BODY_CHARS)}`);
    lines.push(`--- meta ---\n${JSON.stringify(capture.structuredData.meta).slice(0, 4_000)}`);
    lines.push(`--- visible text around the expected value ---\n${textWindows(capture.html, e.expected[url] ?? '')}`);
  }
  return lines.join('\n');
}

export async function proposeWithAi(e: FallbackEvidence, agent: ProposePathsAgent): Promise<CandidatePath[]> {
  const proposals = await agent.proposePaths(buildProposePrompt(e));
  return proposals.map((p) => ({ source: p.source, path: p.path, transform: p.transform }));
}
