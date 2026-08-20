// The four origins are disjoint partitions of the schema, so assembling the
// final row is a plain key merge — no precedence rules, because no two origins
// can claim the same field.

import type { OriginField } from './partition-schema.js';

export type MergeRowArgs = {
  inputFields: OriginField[];
  inputValues: Record<string, unknown>;
  listingValues: Record<string, unknown>;
  detailRow: Record<string, unknown>;
  url: string;
  /** The listing page this URL was discovered on; null when there was no listing phase. */
  pageNumber: number | null;
};

export function mergeRow(args: MergeRowArgs): Record<string, unknown> {
  const fromInput: Record<string, unknown> = {};
  for (const field of args.inputFields) {
    const column = field.input_column ?? field.name;
    fromInput[field.name] = args.inputValues[column] ?? null;
  }

  return {
    ...fromInput,
    ...args.listingValues,
    ...args.detailRow,
    _url: args.url,
    _page_number: args.pageNumber,
  };
}
