import type { InterceptedRequest, StructuredData } from '@robot/browser';
import type { FieldPathSet } from '../domain-cache.js';

export type Fixture = {
  label: string;
  url: string;
  domain: string;
  pageType: 'detail' | 'listing';
  capturedAt: string;
  html: string;
  structuredData: StructuredData;
  interceptedRequests: InterceptedRequest[];
  fieldPaths: Record<string, FieldPathSet>;
  /** Golden expected values per field; `null` = legitimately not on the page. */
  expected: Record<string, unknown>;
};
