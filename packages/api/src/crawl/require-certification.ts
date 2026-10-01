// packages/api/src/crawl/require-certification.ts
// The gate that keeps a customer-schema Source honest at scale: no
// extraction — planning, probing, or executing — proceeds against a customer
// schema until it has a current certification. A legacy Source (no
// schemaDefinition) is untouched; this is customer-schema-only.
//
// Variants (spec 2026-10-01): once the fields are certified, a website whose
// project wants variants must also have them set up, and verified as they
// stand now. A project that ignores variants, or a website with "no
// variants", gates exactly as before.

import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { sources } from '@robot/db';
import type { Database } from '@robot/db';
import { isCustomerSchema } from './effective-schema.js';
import { loadCurrentCertification, loadVariantCurrency, type Certification } from '../verify/current-certification.js';

export async function requireCertification(db: Database, sourceId: string): Promise<Certification | null> {
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true } });
  if (!source || !isCustomerSchema(source)) return null;
  const cert = await loadCurrentCertification(db, sourceId);
  if (!cert) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Verify the schema before extracting' });
  if (cert.variants) return cert; // required, current and passed

  const variants = await loadVariantCurrency(db, sourceId);
  if (variants.required === 'setup-missing') {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: "Set up this website's variants before extracting" });
  }
  if (variants.required === 'yes' && !(variants.current && variants.passed)) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Verify the variants before extracting' });
  }
  return variants.required === 'yes' && variants.result ? { ...cert, variants: variants.result } : cert;
}
