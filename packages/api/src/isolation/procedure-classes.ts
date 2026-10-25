// packages/api/src/isolation/procedure-classes.ts
// Every tRPC procedure, classified (spec 2026-10-24 tenant isolation §2.1). The procedure sweep fails on a path
// missing here, or named here and gone: a new procedure must say how it is scoped before it can merge. Input builders
// take a fixture: `scoped` and `membership` ones are fed the OTHER org's, the rest the caller's own.
import type { OrgFixture } from './two-orgs.js';

export type ProcedureClass = 'scoped' | 'org-wide' | 'self' | 'membership' | 'ops' | 'public';
type Build = (f: OrgFixture) => unknown;

export type ProcedureEntry =
  /** Takes ids of one org's rows. `works`: the real work the call does for its own org (a worker job) — only ever
   *  exercised as a refusal; the money sweep does not call it. */
  | { class: 'scoped'; input: Build; works?: string }
  /** No ids; answers about, or acts on, the caller's own org. `refuses`: the refusal the fixture's caller gets by design. */
  | { class: 'org-wide'; input?: Build; refuses?: 'PRECONDITION_FAILED' | 'FORBIDDEN' }
  /** Only the caller's own user or session. */
  | { class: 'self'; input?: Build }
  /** Takes a user or org id that must be a membership of the caller; each of `inputs(B)` is refused with `refusal`. */
  | { class: 'membership'; inputs: (b: OrgFixture) => unknown[]; refusal: 'NOT_FOUND' | 'FORBIDDEN' }
  /** Operators only. */
  | { class: 'ops'; input?: Build }
  /** No session needed; the answer names nothing of another org. */
  | { class: 'public'; input?: Build };

const month = () => new Date().toISOString().slice(0, 7);
const site = (f: OrgFixture) => ({ sourceId: f.sourceId });
const run = (f: OrgFixture) => ({ runId: f.runId });
const ds = (f: OrgFixture) => ({ datasetId: f.datasetId });

export const PROCEDURE_CLASSES: Record<string, ProcedureEntry> = {
  // ─── auth ───
  'auth.signIn': { class: 'public', input: (f) => ({ email: f.owner.user.email, password: 'x' }) },
  'auth.signOut': { class: 'self' },
  'auth.me': { class: 'self' },
  'auth.switchOrg': { class: 'membership', inputs: (b) => [{ orgId: b.org.id }], refusal: 'FORBIDDEN' },
  'auth.setTheme': { class: 'self', input: () => ({ theme: 'light' }) },
  'auth.updateName': { class: 'self', input: () => ({ name: 'Renamed by the sweep' }) },
  // ─── account ───
  'account.emailPrefs': { class: 'self' },
  'account.updateEmailPrefs': { class: 'self', input: () => ({ attention: false }) },
  // ─── orgs ───
  'orgs.create': { class: 'self', input: () => ({ name: 'Sweep side org' }) },
  'orgs.rename': { class: 'org-wide', input: (f) => ({ name: `${f.org.name} renamed` }) },
  // A's org is its owner's personal one, which cannot be deleted: the sweep sees the refusal, never a deleted org.
  'orgs.delete': { class: 'org-wide', refuses: 'PRECONDITION_FAILED' },
  'orgs.members.list': { class: 'org-wide' },
  'orgs.members.setRole': { class: 'membership', inputs: (b) => [{ userId: b.member.id, role: 'admin' }, { userId: b.owner.user.id, role: 'member' }], refusal: 'NOT_FOUND' },
  'orgs.members.remove': { class: 'membership', inputs: (b) => [{ userId: b.member.id }, { userId: b.owner.user.id }], refusal: 'NOT_FOUND' },
  'orgs.staffActivity': { class: 'org-wide', input: () => ({ page: 0 }) },
  // Staff only (spec 2026-10-24 metering §2.2): A's owner is a plain customer, so the sweep sees the refusal.
  'orgs.setAiCap': { class: 'org-wide', input: () => ({ capUsd: 40 }), refuses: 'FORBIDDEN' },
  // ─── projects ───
  'projects.list': { class: 'org-wide' },
  'projects.get': { class: 'scoped', input: (f) => ({ projectSlug: f.projectSlug }) },
  'projects.output': { class: 'scoped', input: (f) => ({ projectSlug: f.projectSlug }) },
  'projects.create': { class: 'org-wide', input: () => ({ name: 'Sweep project' }) },
  'projects.rename': { class: 'scoped', input: (f) => ({ projectId: f.projectId, name: 'Stray' }) },
  'projects.delete': { class: 'scoped', input: (f) => ({ projectId: f.projectId }) },
  // ─── datasets ───
  'datasets.catalogue': { class: 'public' },
  'datasets.addField': { class: 'scoped', input: (f) => ({ ...ds(f), name: 'Stray', type: 'text' }) },
  'datasets.renameField': { class: 'scoped', input: (f) => ({ ...ds(f), key: f.keys.title, name: 'Stray' }) },
  'datasets.retypeField': { class: 'scoped', input: (f) => ({ ...ds(f), key: f.keys.title, type: 'number' }) },
  'datasets.deleteField': { class: 'scoped', input: (f) => ({ ...ds(f), key: f.keys.title }) },
  'datasets.fieldStatus': { class: 'scoped', input: ds },
  'datasets.variants': { class: 'scoped', input: ds },
  'datasets.setVariantMode': { class: 'scoped', input: (f) => ({ ...ds(f), mode: 'row_per_variant' }) },
  'datasets.setFieldLevel': { class: 'scoped', input: (f) => ({ ...ds(f), key: f.keys.title, level: 'variant' }) },
  'datasets.addAxis': { class: 'scoped', input: (f) => ({ ...ds(f), name: 'Stray' }) },
  'datasets.renameAxis': { class: 'scoped', input: (f) => ({ ...ds(f), key: f.axisKey, name: 'Stray' }) },
  'datasets.deleteAxis': { class: 'scoped', input: (f) => ({ ...ds(f), key: f.axisKey }) },
  // ─── sources ───
  'sources.get': { class: 'scoped', input: (f) => ({ projectSlug: f.projectSlug, sourceSlug: f.sourceSlug }) },
  'sources.update': { class: 'scoped', input: (f) => ({ id: f.sourceId, isActive: false }) },
  'sources.rotateWebhookSecret': { class: 'scoped', input: (f) => ({ id: f.sourceId }) },
  'sources.createInProject': { class: 'scoped', input: (f) => ({ projectSlug: f.projectSlug, name: 'Stray', url: f.urls[0] }) },
  'sources.rename': { class: 'scoped', input: (f) => ({ ...site(f), name: 'Stray' }) },
  'sources.setListingPages': { class: 'scoped', input: (f) => ({ ...site(f), urls: [`https://${f.host}/l`] }) },
  'sources.setProductUrls': { class: 'scoped', input: (f) => ({ ...site(f), urls: [f.urls[0]] }) },
  'sources.inputRows': { class: 'scoped', input: site },
  'sources.updateBinding': { class: 'scoped', input: (f) => ({ ...site(f), urls: f.urls, descriptions: {}, expected: {} }) },
  // The two address checks (spec 2026-10-24 proxy §2.2, Task 4 fix round I1): with a `sourceId` they read that website's
  // pages through its profile, so the website is checked against the caller's org first; without one, an address alone,
  // which touches no org's rows (covered by the network rate limit, §2.4). Swept with the other org's website.
  'sources.checkListingPage': { class: 'scoped', input: (f) => ({ ...site(f), listingUrl: `https://${f.host}/l` }), works: 'a listing-check job' },
  'sources.reachability': { class: 'scoped', input: (f) => ({ ...site(f), url: f.urls[0] }), works: 'a reachability job' },
  'sources.captureProofPage': { class: 'scoped', input: (f) => ({ ...site(f), url: f.urls[0] }), works: 'a proof-page capture job' },
  'sources.proofPageCapture': { class: 'scoped', input: (f) => ({ captureId: f.captureId }) },
  'sources.proofPageCaptures': { class: 'scoped', input: (f) => ({ ...site(f), urls: [f.urls[0]] }) },
  'sources.suggestMarks': { class: 'scoped', input: (f) => ({ captureId: f.captureId }) },
  'sources.jevReadings': { class: 'scoped', input: (f) => ({ ...site(f), captureIds: [f.captureId] }) },
  'sources.transferMarks': { class: 'scoped', input: (f) => ({ ...site(f), fromUrl: f.urls[0], toUrls: [f.urls[1]] }), works: 'a transfer-marks job' },
  'sources.confirm': { class: 'scoped', input: site, works: 'a plan job and a full run' },
  'sources.delete': { class: 'scoped', input: site },
  'sources.verifyEstimate': { class: 'scoped', input: site },
  'sources.verify': { class: 'scoped', input: site, works: 'a verify job' },
  'sources.verificationStatus': { class: 'scoped', input: site },
  'sources.checkDrift': { class: 'scoped', input: site, works: 'a drift-check job' },
  'sources.driftCheck': { class: 'scoped', input: site },
  'sources.coverage': { class: 'scoped', input: site },
  'sources.attention': { class: 'scoped', input: site },
  'sources.detectVariants': { class: 'scoped', input: site, works: 'a detect-variants job' },
  'sources.setVariantSetup': { class: 'scoped', input: (f) => ({ ...site(f), method: 'none', axes: [] }) },
  'sources.saveVariantAnswer': { class: 'scoped', input: (f) => ({ ...site(f), url: f.urls[0], answer: null }) },
  'sources.variantList': { class: 'scoped', input: (f) => ({ ...site(f), url: f.urls[0], list: { source: 'json-ld', path: 'offers' } }) },
  'sources.variantLinksNear': { class: 'scoped', input: (f) => ({ ...site(f), url: f.urls[0], xpath: '//a' }), works: 'a variant-links-near job' },
  // ─── ops ───
  'ops.me': { class: 'public' },
  'ops.websites': { class: 'ops' },
  'ops.website': { class: 'ops', input: site },
  'ops.enterOrg': { class: 'ops', input: site },
  'ops.leaveOrg': { class: 'self' },
  'ops.staffActivity': { class: 'ops', input: (f) => ({ orgId: f.org.id }) },
  'ops.staffActivityFilters': { class: 'ops' },
  'ops.orgs': { class: 'ops', input: (f) => ({ orgId: f.org.id }) },
  'ops.queue': { class: 'ops' },
  // ─── runs ───
  'runs.getWithDetails': { class: 'scoped', input: (f) => ({ id: f.runId }) },
  'runs.listBySource': { class: 'scoped', input: site },
  'runs.listByOrg': { class: 'org-wide' },
  // ─── crawl ───
  'crawl.plan': { class: 'scoped', input: (f) => ({ ...site(f), probe: true }), works: 'a plan job' },
  'crawl.probeAndSample': { class: 'scoped', input: site, works: 'a plan job and a sample run' },
  'crawl.items': { class: 'scoped', input: run },
  'crawl.status': { class: 'scoped', input: run },
  'crawl.cancel': { class: 'scoped', input: run },
  'crawl.execute': { class: 'scoped', input: (f) => ({ ...run(f), dryRun: true }), works: 'a run job' },
  'crawl.coverage': { class: 'scoped', input: run },
  'crawl.misses': { class: 'scoped', input: run },
  'crawl.backfillPreview': { class: 'scoped', input: run },
  'crawl.backfill': { class: 'scoped', input: run, works: 'a backfill run' },
  // ─── usage ───
  'usage.byProject': { class: 'org-wide', input: () => ({ month: month() }) },
};
