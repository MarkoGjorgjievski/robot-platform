// packages/api/src/verify/jev-agreement.ts
// Spec 2026-10-16 §7: when a Verify completes, Jev's picks against what the
// customer verified. Measurement only: written to `verify_agreement` on the
// verification row and nowhere else, never read by Verify, a run or a gate (§10.2).
import { and, eq, inArray } from 'drizzle-orm';
import { db, jevReadings, sourceVerifications } from '@robot/db';
import { normalize, type CustomerFieldType, type FieldVerification, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import type { JevAnswers } from './jev-reading.js';

export type JevAgreementCell = {
  pick: string; value: string | null; p: number; expected: string; agree: boolean;
  /** Whether the field certified on this Verify (spec §7); absent when the results were not given. */
  certified?: boolean;
};
export type JevAgreement = {
  asked: number; agreed: number;
  pages: Record<string, { readingId: string; fields: Record<string, JevAgreementCell>; variant?: { pick: string; pageMatch: string | null; agree: boolean } }>;
};

const text = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
/** Money and numbers by amount, everything else by normalised text (the experiments' `sameValue`). */
const same = (type: CustomerFieldType, a: string, b: string) => {
  if (type === 'money' || type === 'number') { const x = normalize(type, a); return x !== null && x === normalize(type, b); }
  return text(a) === text(b);
};

export function agreementOf(
  fields: Array<{ key: string; type: CustomerFieldType }>,
  set: VerificationSet,
  readings: Array<{ id: string; url: string; answers: JevAnswers }>,
  certified?: Record<string, boolean>,
): JevAgreement | null {
  if (readings.length === 0) return null;
  const out: JevAgreement = { asked: 0, agreed: 0, pages: {} };
  for (const r of readings) {
    const page: JevAgreement['pages'][string] = { readingId: r.id, fields: {} };
    for (const f of fields) {
      const a = r.answers.fields[f.key];
      const expected = (set.expected[f.key]?.[r.url] ?? '').trim();
      if (!a || expected === '') continue;
      const value = a.pick === 'none' ? null : a.candidates.find((c) => c.id === a.pick)?.value ?? null;
      const agree = value !== null && same(f.type, value, expected);
      page.fields[f.key] = { pick: a.pick, value, p: a.p, expected, agree, ...(certified ? { certified: certified[f.key] ?? false } : {}) };
      out.asked++;
      if (agree) out.agreed++;
    }
    if (r.answers.variant) page.variant = { pick: r.answers.variant.pick, pageMatch: r.answers.variant.pageMatch, agree: r.answers.variant.pick === r.answers.variant.pageMatch };
    out.pages[r.url] = page;
  }
  return out;
}

/** A field certified when it has certified paths (empty when it failed) or passed by default only. */
function certifiedOf(results: Record<string, FieldVerification>): Record<string, boolean> {
  return Object.fromEntries(Object.entries(results).map(([key, r]) => [key, r.certified.length > 0 || r.defaultOnly === true]));
}

/**
 * Never throws: agreement is measurement, not Verify. Scores, per proof page, the `done` reading
 * of the capture this Verify used (`captureRefs`, its `captures` column); a page whose capture has
 * no done reading has none here — an older reading, of another capture, is never scored.
 */
export async function recordJevAgreement(
  verificationId: string,
  sourceId: string,
  fields: SchemaDefinitionField[],
  set: VerificationSet,
  captureRefs: Record<string, { captureId: string }>,
  results?: Record<string, FieldVerification>,
): Promise<void> {
  try {
    const urlOf = new Map<string, string>();
    for (const url of set.urls) { const id = captureRefs[url]?.captureId; if (id) urlOf.set(id, url); }
    if (urlOf.size === 0) return;
    const rows = await db.query.jevReadings.findMany({
      where: and(eq(jevReadings.sourceId, sourceId), eq(jevReadings.status, 'done'), inArray(jevReadings.captureId, [...urlOf.keys()])),
      columns: { id: true, url: true, captureId: true, answers: true },
    });
    const readings = rows
      .filter((r) => r.answers && urlOf.get(r.captureId) === r.url)
      .map((r) => ({ id: r.id, url: r.url, answers: r.answers as JevAnswers }));
    const agreement = agreementOf(fields, set, readings, results ? certifiedOf(results) : undefined);
    if (agreement) await db.update(sourceVerifications).set({ verifyAgreement: agreement }).where(eq(sourceVerifications.id, verificationId));
  } catch (err) {
    console.error(`[jev] agreement for ${verificationId} failed:`, err);
  }
}
