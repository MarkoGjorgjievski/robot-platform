// syncAttention (spec 2026-10-24 email §3.2): one email per off → on turn, claimed with attention_since; and every
// edit that can change "Needs attention" syncs it.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { db, driftChecks, emailMessages, fieldHolds, sources, sourceVerifications, users } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { seedAttention } from '../test-helpers/seed-attention.js';
import { syncAttention, syncAttentionSafely } from './attention-sync.js';

const me = await signedInCaller('attention-sync');
afterAll(async () => { await me.cleanup(); });

async function website(tag: string) {
  const urls = [1, 2, 3].map((n) => `https://test-attn-sync-${tag}.example.com/p/${n}`);
  return createProjectWithSource(me.caller, {
    tag: `attn-sync-${tag}`, urls, fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }],
    expected: { Price: Object.fromEntries(urls.map((u, i) => [u, `${i + 1}.00`])), Title: Object.fromEntries(urls.map((u, i) => [u, `T${i}`])) },
  });
}
type Site = Awaited<ReturnType<typeof website>>;
const needsYou = (s: Site) => seedAttention(s.sourceId, { heldKey: s.keys.Title!, refreshedKey: s.keys.Price! });
const sinceOf = async (id: string) => (await db.query.sources.findFirst({ where: eq(sources.id, id), columns: { attentionSince: true } }))!.attentionSince;
const sent = (id: string) => db.select().from(emailMessages).where(like(emailMessages.dedupeKey, `attention:${id}:%`));
/** Nothing needs the customer any more: the hold and the check's finding are gone. */
async function settle(id: string) {
  await db.delete(fieldHolds).where(eq(fieldHolds.sourceId, id));
  await db.delete(driftChecks).where(eq(driftChecks.sourceId, id));
}
/** Marks a website as turned to attention while nothing needs it: the next sync must clear it. */
const mark = (id: string) => db.update(sources).set({ attentionSince: new Date() }).where(eq(sources.id, id));

describe('syncAttention (spec §3.2)', () => {
  it('queues once on off → on, not again while on, and again after on → off → on', async () => {
    const s = await website('cycle');
    try {
      expect(await syncAttention(db, s.sourceId)).toEqual({ on: false, turnedOn: false, queued: 0 });
      await needsYou(s);
      expect(await syncAttention(db, s.sourceId)).toEqual({ on: true, turnedOn: true, queued: 1 });
      const since = await sinceOf(s.sourceId);
      expect(since).not.toBeNull();
      const rows = await sent(s.sourceId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: me.user.id, dedupeKey: `attention:${s.sourceId}:${since!.getTime()}:${me.user.id}`, subject: 'Site attn-sync-cycle needs your attention' });
      expect(rows[0]!.text).toContain('Title needs you');
      expect(await syncAttention(db, s.sourceId)).toEqual({ on: true, turnedOn: false, queued: 0 });
      await settle(s.sourceId);
      expect(await syncAttention(db, s.sourceId)).toMatchObject({ on: false });
      expect(await sinceOf(s.sourceId)).toBeNull();
      await needsYou(s);
      expect(await syncAttention(db, s.sourceId)).toMatchObject({ turnedOn: true, queued: 1 });
      expect(await sent(s.sourceId)).toHaveLength(2);
    } finally { await s.cleanup(); }
  });

  it('two syncs at once queue once', async () => {
    const s = await website('race');
    try {
      await needsYou(s);
      const both = await Promise.all([syncAttention(db, s.sourceId), syncAttention(db, s.sourceId)]);
      expect(both.filter((r) => r.turnedOn)).toHaveLength(1);
      expect(await sent(s.sourceId)).toHaveLength(1);
    } finally { await s.cleanup(); }
  });

  it('an owner who turned attention emails off gets none; the turn is still recorded', async () => {
    await db.update(users).set({ emailAttention: false }).where(eq(users.id, me.user.id));
    const s = await website('quiet');
    try {
      await needsYou(s);
      expect(await syncAttention(db, s.sourceId)).toEqual({ on: true, turnedOn: true, queued: 0 });
      expect(await sinceOf(s.sourceId)).not.toBeNull();
      expect(await sent(s.sourceId)).toEqual([]);
    } finally {
      await db.update(users).set({ emailAttention: true }).where(eq(users.id, me.user.id));
      await s.cleanup();
    }
  });

  it('syncAttentionSafely never throws (§4.3)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(syncAttentionSafely(db, ['not-a-uuid'])).resolves.toBeUndefined();
      expect(errors).toHaveBeenCalled();
    } finally { errors.mockRestore(); }
  });
});

describe('the edits that can change it sync it (spec §3.2)', () => {
  it('deleting the held field (datasets.deleteField) turns the website back off', async () => {
    const s = await website('delete');
    try {
      await needsYou(s);
      await syncAttention(db, s.sourceId);
      expect(await sinceOf(s.sourceId)).not.toBeNull();
      await me.caller.datasets.deleteField({ datasetId: s.datasetId, key: s.keys.Title! });
      expect(await sinceOf(s.sourceId)).toBeNull();
    } finally { await s.cleanup(); }
  });

  it('a binding save, a field rename, a new field and a retype each sync the websites they touched', async () => {
    const s = await website('edits');
    try {
      await mark(s.sourceId);
      await me.caller.sources.updateBinding({
        sourceId: s.sourceId, urls: s.urls, descriptions: { [s.keys.Price!]: 'x', [s.keys.Title!]: 'x' },
        expected: { [s.keys.Price!]: Object.fromEntries(s.urls.map((u, i) => [u, `${i + 2}.00`])), [s.keys.Title!]: Object.fromEntries(s.urls.map((u, i) => [u, `T${i}`])) },
      });
      expect(await sinceOf(s.sourceId)).toBeNull();
      await mark(s.sourceId);
      await me.caller.datasets.renameField({ datasetId: s.datasetId, key: s.keys.Title!, name: 'Name' });
      expect(await sinceOf(s.sourceId)).toBeNull();
      await mark(s.sourceId);
      const added = await me.caller.datasets.addField({ datasetId: s.datasetId, name: 'Brand', type: 'text' });
      expect(await sinceOf(s.sourceId)).toBeNull();
      await mark(s.sourceId);
      await me.caller.datasets.retypeField({ datasetId: s.datasetId, key: added.key, type: 'number' });
      expect(await sinceOf(s.sourceId)).toBeNull();
    } finally { await s.cleanup(); }
  });
});

describe('fix round 1: one lock per sync, and a Verify in flight decides', () => {
  it('a reset racing a claim never leaves the website on with attention_since cleared (no second email for one turn)', async () => {
    const s = await website('reset-race');
    try {
      let raced: Promise<unknown> | null = null;
      // X reads "off"; between X's read and its reset, the website turns on and Y syncs. Under the row lock the turn
      // waits for X to finish, so X can never clear Y's claim.
      const x = syncAttention(db, s.sourceId, {
        onRead: async (on) => {
          if (on || raced) return;
          raced = needsYou(s).then(() => syncAttention(db, s.sourceId));
          await Promise.race([raced, new Promise((r) => setTimeout(r, 1500))]);
        },
      });
      expect(await x).toMatchObject({ on: false });
      await raced;
      expect(await sinceOf(s.sourceId)).not.toBeNull();
      expect(await syncAttention(db, s.sourceId)).toEqual({ on: true, turnedOn: false, queued: 0 });
      expect(await sent(s.sourceId)).toHaveLength(1);
    } finally { await s.cleanup(); }
  }, 30_000);

  it('while a Verify is in flight a sync never claims, but still resets; the sync after it decides', async () => {
    const s = await website('in-flight');
    try {
      const [row] = await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x' }).returning({ id: sourceVerifications.id });
      await mark(s.sourceId);
      expect(await syncAttention(db, s.sourceId)).toEqual({ on: false, turnedOn: false, queued: 0 });
      expect(await sinceOf(s.sourceId)).toBeNull();
      await needsYou(s);
      expect(await syncAttention(db, s.sourceId)).toEqual({ on: true, turnedOn: false, queued: 0 });
      expect(await sinceOf(s.sourceId)).toBeNull();
      expect(await sent(s.sourceId)).toEqual([]);
      await db.update(sourceVerifications).set({ completedAt: new Date(), errorMessage: 'stalled' }).where(eq(sourceVerifications.id, row!.id));
      expect(await syncAttention(db, s.sourceId)).toEqual({ on: true, turnedOn: true, queued: 1 });
      expect(await sent(s.sourceId)).toHaveLength(1);
    } finally { await s.cleanup(); }
  });
});
