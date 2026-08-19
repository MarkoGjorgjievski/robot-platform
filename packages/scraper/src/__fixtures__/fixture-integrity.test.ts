// Was each fixture captured from the page it claims to be?
//
// Every fixture in this corpus was captured with a popup-dismissal pass that
// could click a link and navigate away (fixed 2026-08-19). On Barnes & Noble it
// did exactly that in three captures out of four, landing on an accessory's page.
// A fixture recorded during such a capture would freeze the WRONG product's data
// as golden — and every replay against it would pass forever, because the fixture
// and its goldens agree with each other perfectly.
//
// This checks each fixture's own contents against the URL it claims, using the
// same identifier logic the live chain now uses. Offline and free: it reads the
// committed JSON, captures nothing.

import { describe, it, expect } from 'vitest';
import { describesSamePage, extractIdentifiers } from '../entity-match.js';
import { listFixtures, loadFixture } from './load.js';

/** Host + the URL's last non-empty path segment, lowercased. `null` if the URL
 * has neither. On Newegg this is the category id (`ID-38`), which survives a
 * slug rename but changes if the capture landed on a different category. */
function hostAndLastSegment(url: string): { host: string; segment: string } | null {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    return { host: u.hostname.toLowerCase(), segment: segments[segments.length - 1]!.toLowerCase() };
  } catch {
    return null;
  }
}

describe('fixture integrity — does the capture match its declared URL?', () => {
  for (const label of listFixtures()) {
    describe(label, () => {
      const fixture = loadFixture(label);

      it('has structured data describing the declared product, not a neighbour', () => {
        const offenders = fixture.structuredData.ldJson
          .map((entity) => ({ entity, verdict: describesSamePage(entity, fixture.url) }))
          .filter((r) => !r.verdict.ok);

        const detail = offenders
          .map((o) => (o.verdict.ok ? '' : `    ${o.verdict.reason}`))
          .join('\n');
        expect(offenders.length, `${label} carries structured data for a different entity:\n${detail}`).toBe(0);
      });

      it('declares a URL that carries identifiers, so the check above can bite', () => {
        // A fixture URL with no identifiers makes the previous test vacuous. Better
        // to know that than to be reassured by a check that cannot fail.
        //
        // Exempt for listing fixtures: a category URL (e.g.
        // `/Video-Cards-Video-Devices/Category/ID-38`) legitimately carries no
        // product identifier — it names a category, not one entity. That does not
        // reopen the gap the test above closes: a listing page's own ldJson blocks
        // (BreadcrumbList, CollectionPage, FAQPage, ItemList, ...) are never
        // `ENTITY_TYPES` candidates in `isEntityCandidate`, so `describesSamePage`
        // cannot false-pass a wrong *product* entity here the way it could on a
        // detail page — there is no per-entity claim on a listing page for it to
        // rubber-stamp.
        if (fixture.pageType === 'listing') return;

        const ids = extractIdentifiers(fixture.url);
        expect(ids.size, `${label}: no identifiers in ${fixture.url} — the entity check cannot discriminate for this fixture`)
          .toBeGreaterThan(0);
      });

      it('captured HTML whose canonical link agrees with the declared URL', () => {
        // The other half of the drift signature: the page's own canonical/og:url.
        // A capture that navigated away carries the destination's canonical.
        const canonical = fixture.html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
          ?? fixture.html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1];
        if (!canonical) return; // Plenty of pages have neither; absence is not evidence.

        const declared = extractIdentifiers(fixture.url);
        const found = extractIdentifiers(canonical);
        if (declared.size === 0 || found.size === 0) return;

        const shared = [...found].some((id) => declared.has(id));
        expect(shared, `${label}: canonical URL ${canonical} shares no identifier with declared ${fixture.url}`).toBe(true);
      });

      it('for listing fixtures, declared URL and canonical agree on host + category (drift check)', () => {
        // The three checks above give listing fixtures no real coverage: test 1
        // is vacuous because a listing page's own ldJson blocks (BreadcrumbList,
        // CollectionPage, FAQPage, ...) are never ENTITY_TYPES candidates, and
        // tests 2 and 3 rely on `extractIdentifiers`, which requires a 6+ char
        // token containing a digit — a category id like `ID-38` never reaches
        // that length, so both no-op. Left there, the exact capture-drift class
        // this file exists to catch would have zero regression coverage for
        // listings — which is exactly what happened capturing this fixture: popup
        // dismissal navigated from the `Video-Cards-Video-Devices` slug to the
        // `GPU-Video-Graphics-Device` slug before the browser caught it and
        // returned (see docs/testing — both slugs are Newegg's ID-38 category,
        // a benign rename, not a different page).
        //
        // This compares host + the URL's last path segment (the category id)
        // between the declared URL and the page's own canonical/og:url. That
        // tolerates the benign slug rename above — the id survives it — while
        // still failing if a capture actually drifted to a different category,
        // which changes the id.
        if (fixture.pageType !== 'listing') return;

        const canonical = fixture.html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
          ?? fixture.html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1];
        if (!canonical) return; // Nothing to compare against; absence is not evidence.

        const declared = hostAndLastSegment(fixture.url);
        const found = hostAndLastSegment(canonical);
        expect(declared, `${label}: declared URL ${fixture.url} has no path segment to compare`).not.toBeNull();
        expect(found, `${label}: canonical URL ${canonical} has no path segment to compare`).not.toBeNull();

        expect(found!.host, `${label}: canonical host ${found!.host} != declared host ${declared!.host}`)
          .toBe(declared!.host);
        expect(
          found!.segment,
          `${label}: canonical category "${found!.segment}" != declared category "${declared!.segment}" (declared ${fixture.url}, canonical ${canonical})`,
        ).toBe(declared!.segment);
      });
    });
  }
});
