import type { PageCapture } from '@robot/browser';
import { getByDotPath } from '../domain-cache.js';
import { inferTransform, inferTransformForType } from './transforms.js';
import { pathFitsConcept } from './field-fit.js';
import type { CustomerFieldType, Transform } from './types.js';

export type StructuredCandidate = { source: 'api' | 'json-ld' | 'meta'; path: string; transform: Transform; raw: unknown };

const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 25;

type Visit = (path: string, value: unknown) => void;

function walk(value: unknown, path: string, depth: number, visit: Visit): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    if (path !== '') visit(path, value); // arrays are candidates themselves (first_of_list)
    value.slice(0, MAX_ARRAY_ITEMS).forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1, visit));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, path === '' ? k : `${path}.${k}`, depth + 1, visit);
    }
    return;
  }
  if (path !== '') visit(path, value);
}

function apiBodies(capture: Pick<PageCapture, 'interceptedRequests'>): unknown[] {
  return capture.interceptedRequests.filter((r) => r.isJson && r.parsedJson !== null).map((r) => r.parsedJson);
}

export function searchStructured(
  capture: Pick<PageCapture, 'url' | 'structuredData' | 'interceptedRequests'>,
  type: CustomerFieldType,
  expected: string,
): StructuredCandidate[] {
  const ctx = { pageUrl: capture.url };
  const out: StructuredCandidate[] = [];
  const seen = new Set<string>();
  const consider = (source: StructuredCandidate['source'], path: string, raw: unknown) => {
    const transform = inferTransform(type, raw, expected, ctx);
    if (transform === null) return;
    const id = `${source} ${path}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ source, path, transform, raw });
  };
  for (const body of apiBodies(capture)) walk(body, '', 0, (p, v) => consider('api', p, v));
  for (const block of capture.structuredData.ldJson) walk(block, '', 0, (p, v) => consider('json-ld', p, v));
  for (const [k, v] of Object.entries(capture.structuredData.meta)) consider('meta', k, v);
  return out;
}

export type ConceptCandidate = { source: 'api' | 'json-ld' | 'meta'; path: string; transform: Transform; raw: unknown };

/**
 * Structured leaves that could stand for a field by LOCATION alone: the
 * path fits the field's concept (`pathFitsConcept`), and the raw value
 * parses as the field's type via some transform — picked the way
 * `inferTransform` would, just without an expected value to match. Unlike
 * `searchStructured`, this never filters on value: it is for drift's
 * "changed" search, which is hunting for a path whose value is now
 * different, not one that matches anything in particular.
 */
export function searchStructuredByConcept(
  capture: Pick<PageCapture, 'url' | 'structuredData' | 'interceptedRequests'>,
  type: CustomerFieldType,
  concept: string,
): ConceptCandidate[] {
  const ctx = { pageUrl: capture.url };
  const out: ConceptCandidate[] = [];
  const seen = new Set<string>();
  const consider = (source: ConceptCandidate['source'], path: string, raw: unknown) => {
    if (!pathFitsConcept(concept, path)) return;
    const transform = inferTransformForType(type, raw, ctx);
    if (transform === null) return;
    const id = `${source} ${path}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ source, path, transform, raw });
  };
  for (const body of apiBodies(capture)) walk(body, '', 0, (p, v) => consider('api', p, v));
  for (const block of capture.structuredData.ldJson) walk(block, '', 0, (p, v) => consider('json-ld', p, v));
  for (const [k, v] of Object.entries(capture.structuredData.meta)) consider('meta', k, v);
  return out;
}

function nonEmpty(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

export function resolveStructured(
  capture: Pick<PageCapture, 'structuredData' | 'interceptedRequests'>,
  source: 'api' | 'json-ld' | 'meta',
  path: string,
): unknown {
  if (source === 'meta') return capture.structuredData.meta[path];
  const containers = source === 'api' ? apiBodies(capture) : capture.structuredData.ldJson;
  for (const c of containers) {
    const v = getByDotPath(c, path);
    if (nonEmpty(v)) return v;
  }
  return undefined;
}
