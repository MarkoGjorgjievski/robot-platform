// packages/api/src/crawl/require-certification.ts
// The gate that keeps a customer-schema Source honest at scale: no
// extraction — planning, probing, or executing — proceeds against a customer
// schema until it has a current certification. A legacy Source (no
// schemaDefinition) is untouched; this is customer-schema-only.

import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { sources } from '@robot/db';
import type { Database } from '@robot/db';
import { isCustomerSchema } from './effective-schema.js';
import { loadCurrentCertification, type Certification } from '../verify/current-certification.js';

export async function requireCertification(db: Database, sourceId: string): Promise<Certification | null> {
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true } });
  if (!source || !isCustomerSchema(source)) return null;
  const cert = await loadCurrentCertification(db, sourceId);
  if (!cert) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Verify the schema before extracting' });
  return cert;
}
