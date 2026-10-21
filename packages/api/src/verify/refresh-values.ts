// packages/api/src/verify/refresh-values.ts
// Websites change (spec 2026-10-21 §3.2): apply the refreshes a check planned
// — new expected values for by-nature fields, the hold that keeps the field
// certified through the change, one `value_refreshes` row each — then start a
// free re-verify of those fields on the check's own captures. Never a model:
// the re-verify is `free` and refresh-origin (it starts no check of its own).
// Nothing here writes `staff_actions`: an automatic change is not staff
// touching a customer's data (spec §3.2).
import { and, eq, inArray } from 'drizzle-orm';
import { db, driftChecks, fieldHolds, sources, valueRefreshes } from '@robot/db';
import { fieldHash, type RefreshPage, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { certifyingResult, loadFieldCurrency, sourceDefinitionHash } from './current-certification.js';
import { resolveInFlightVerification, startVerificationRow } from './in-flight.js';
import { runSourceVerification } from './run-source-verification.js';
import type { StoredCaptureRef } from './capture-store.js';

/** One field's planned refresh, with the field hash the check read under. */
export type RefreshRequest = { key: string; pages: Record<string, RefreshPage>; basisHash: string };

/** Why a planned refresh was not written: a Verify in flight, the field moved since the check read it, or the check was closed (stalled) before it could write. */
export type RefreshSkip = 'busy' | 'moved' | 'closed';
export type RefreshOutcome = { applied: string[]; skipped: Record<string, RefreshSkip> };

const allSkipped = (requests: RefreshRequest[], why: RefreshSkip): RefreshOutcome => ({ applied: [], skipped: Object.fromEntries(requests.map((r) => [r.key, why])) });

/**
 * All of a check's refreshes in one transaction, under the website row lock every Verify start and
 * `updateBinding` take — the in-flight check and the writes both happen under it, so no Verify interleaves
 * (fix wave 1, item 5). A field is
 * skipped as `moved` when its hash or any refreshed cell's stored value changed since the check read them (or
 * it has no certifying result any more), and everything is skipped as `busy` while a Verify is in flight
 * (spec §3.2, §7.4). Only `expected` changes: marks, paths, defaults and absences are carried as they are.
 * A check already closed (as stalled) writes nothing — everything is skipped as `closed` — and the check row
 * is held locked until commit, so it cannot be closed while its refreshes are written (fix wave 1, item 7).
 */
export async function applyRefreshes(sourceId: string, checkId: string | null, requests: RefreshRequest[]): Promise<RefreshOutcome> {
  if (requests.length === 0) return { applied: [], skipped: {} };
  return db.transaction(async (tx) => {
    const [locked] = await tx.select({ schemaDefinition: sources.schemaDefinition, verificationSet: sources.verificationSet }).from(sources).where(eq(sources.id, sourceId)).for('update');
    // Under the lock, as every Verify start checks (it also closes a stalled row, so a crash leftover never blocks).
    if (checkId) {
      const [check] = await tx.select({ status: driftChecks.status }).from(driftChecks).where(eq(driftChecks.id, checkId)).for('update');
      if (check?.status !== 'running') return allSkipped(requests, 'closed');
    }
    if (await resolveInFlightVerification(tx, sourceId)) return allSkipped(requests, 'busy');
    // Read under the lock too: no Verify can start, so none can finish, until this commits.
    const currency = await loadFieldCurrency(tx, sourceId);
    const fields = (Array.isArray(locked?.schemaDefinition) ? locked!.schemaDefinition : []) as SchemaDefinitionField[];
    let set = (locked?.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
    const applied: string[] = [];
    const skipped: Record<string, RefreshSkip> = {};
    for (const req of requests) {
      const field = fields.find((f) => f.key === req.key);
      const certifying = certifyingResult(currency, req.key);
      const fromHash = field ? fieldHash(field, set) : null;
      const unchanged = !!field && !!certifying && fromHash === req.basisHash
        && Object.entries(req.pages).every(([url, p]) => (set.expected[req.key]?.[url] ?? '') === p.was);
      if (!field || !certifying || !unchanged) { skipped[req.key] = 'moved'; continue; }
      const expected = { ...(set.expected[req.key] ?? {}) };
      for (const [url, p] of Object.entries(req.pages)) expected[url] = p.now;
      set = { ...set, expected: { ...set.expected, [req.key]: expected } };
      const toHash = fieldHash(field, set);
      // The hold stands for the hash it passed at, every refresh's since, and this one's: a stale autosave
      // writing an old value back lands on a hash the hold still stands for.
      const fieldHashes = [...new Set([...certifying.fieldHashes, fromHash!, toHash])];
      const values = {
        result: certifying.result, verificationId: certifying.verificationId, verifiedAt: certifying.verifiedAt,
        failedVerificationId: currency.held[req.key]?.failedVerificationId ?? null, fieldHashes, updatedAt: new Date(),
      };
      await tx.insert(fieldHolds).values({ sourceId, fieldKey: req.key, ...values })
        .onConflictDoUpdate({ target: [fieldHolds.sourceId, fieldHolds.fieldKey], set: values });
      await tx.insert(valueRefreshes).values({ sourceId, fieldKey: req.key, driftCheckId: checkId, pages: req.pages, fromHash: fromHash!, toHash });
      applied.push(req.key);
    }
    if (applied.length > 0) await tx.update(sources).set({ verificationSet: set, updatedAt: new Date() }).where(eq(sources.id, sourceId));
    return { applied, skipped };
  });
}

/**
 * The free re-verify of refreshed fields on the check's captures (spec §3.2): `onlyKeys`, `free`, origin
 * `refresh` — so it never calls a model and never starts another check. None while another Verify is in
 * flight. Returns the new verification's id, or null. Fire-and-forget: the run is never awaited.
 */
export async function startRefreshVerify(
  sourceId: string,
  keys: string[],
  captureRefs: Record<string, StoredCaptureRef>,
  deps: { run?: typeof runSourceVerification; checkId?: string | null } = {},
): Promise<string | null> {
  if (keys.length === 0) return null;
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  const hash = source ? sourceDefinitionHash(source) : null;
  if (!hash) return null;
  // The same start as `sources.verify`: the in-flight check and the insert under the website row lock. The check's
  // refresh log names this re-verify in that same transaction, before it runs (review Minor 1): attention reads the
  // link to know which fields a refresh's re-verify verified (follow-ups §1), so an unlinked one must never exist.
  const checkId = deps.checkId;
  const start = await startVerificationRow(db, sourceId, hash, checkId
    ? (tx, id) => tx.update(valueRefreshes).set({ verificationId: id }).where(and(eq(valueRefreshes.driftCheckId, checkId), inArray(valueRefreshes.fieldKey, keys)))
    : undefined);
  if (start.status === 'in-progress') return null;
  const id = start.verificationId;
  void (deps.run ?? runSourceVerification)(sourceId, id, { onlyKeys: keys, free: true, origin: 'refresh', captureRefs })
    .catch((err) => console.error(`[refresh] re-verify ${id} failed:`, err));
  return id;
}
