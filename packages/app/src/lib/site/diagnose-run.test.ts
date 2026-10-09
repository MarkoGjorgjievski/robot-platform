import { describe, it, expect } from 'vitest';
import { diagnoseRun, type DiagnoseRunInput } from './diagnose-run';

/** A clean-slate input every test overrides just the field(s) it's testing. */
const base = (over: Partial<DiagnoseRunInput> = {}): DiagnoseRunInput => ({
  warnings: [],
  errors: [],
  itemFailures: [],
  ...over,
});

describe('diagnoseRun — empty input', () => {
  it('returns [] for a run with no symptoms at all', () => {
    expect(diagnoseRun(base())).toEqual([]);
  });

  it('returns [] when rowsFound is present but non-zero and nothing else fired', () => {
    expect(diagnoseRun(base({ rowsFound: 12 }))).toEqual([]);
  });
});

describe('diagnoseRun — blocked', () => {
  it('diagnoses a direct blockedReason field', () => {
    const result = diagnoseRun(base({ blockedReason: 'CAPTCHA detected — site requires human verification' }));
    expect(result).toEqual([{
      severity: 'blocked',
      title: 'Site blocked our requests',
      detail: 'CAPTCHA detected — site requires human verification — wait and retry; long-term this needs the proxy line item.',
    }]);
  });

  it('diagnoses a per-item "Page blocked or unusable" failure', () => {
    // Verbatim from packages/scraper/src/extraction-orchestrator.ts, wrapping
    // a packages/browser/src/page-health.ts reason.
    const result = diagnoseRun(base({
      itemFailures: [
        { url: 'https://example.com/p/1', error: 'Page blocked or unusable: reCAPTCHA detected — site requires human verification' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('blocked');
  });

  it('diagnoses a "verify you are human" fragment surfaced without the wrapper', () => {
    // "verify you are human" is one of packages/browser/src/page-health.ts's
    // `robot` pattern's `includes` phrases — the phrase itself, not the
    // "Page blocked or unusable" wrapper, is what this test's regex matches.
    const result = diagnoseRun(base({
      errors: [{ message: 'listing capture failed: page asked to verify you are human before continuing' }],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('blocked');
  });

  it('diagnoses a refused listing from its verdict sentence alone (no wrapper since 2026-10-09)', () => {
    const result = diagnoseRun(base({
      errors: [{ message: "scan.co.uk refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet." }],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('blocked');
  });

  // Ruling R4 regression: unwrapping the "Page blocked or unusable" prefix to
  // check for a 404 must not misclassify a genuine (non-404) block as
  // something else — a wrapped CAPTCHA reason stays `blocked`.
  it('stays blocked for a wrapped CAPTCHA reason (not a 404) — R4 regression', () => {
    const result = diagnoseRun(base({
      itemFailures: [
        { url: 'https://example.com/p/1', error: 'Page blocked or unusable: CAPTCHA detected — site requires human verification' },
      ],
    }));
    expect(result).toEqual([{
      severity: 'blocked',
      title: 'Site blocked our requests',
      detail: 'Page blocked or unusable: CAPTCHA detected — site requires human verification — wait and retry; long-term this needs the proxy line item.',
    }]);
  });
});

describe('diagnoseRun — wrong-page (0 rows)', () => {
  it('diagnoses an explicit rowsFound: 0', () => {
    const result = diagnoseRun(base({ rowsFound: 0 }));
    expect(result).toEqual([{
      severity: 'wrong-page',
      title: 'No rows found',
      detail: 'No product rows on this page — is it really a listing? It may be a detail page or a hub.',
    }]);
  });
});

describe('diagnoseRun — pagination', () => {
  it('diagnoses the hub case: "no pagination detected"', () => {
    // Verbatim from packages/scraper/src/crawl/plan-run.ts.
    const result = diagnoseRun(base({
      rowsFound: 24,
      warnings: ['no pagination detected on https://example.com/c/shoes — planned page 1 only'],
    }));
    expect(result).toEqual([{
      severity: 'pagination',
      title: 'No pagination found',
      detail: 'Found 24 products but no way to reach more pages — hub page, or a single-page listing.',
    }]);
  });

  it('diagnoses the thin-walk case: "gained only ... re-serving page 1"', () => {
    // Verbatim from packages/scraper/src/crawl/plan-run.ts.
    const result = diagnoseRun(base({
      warnings: [
        'pagination (mechanical: url-pattern) gained only 1 new item(s) on https://example.com/c/shoes '
        + 'where page 1 yielded 8, and the item budget was not what stopped it '
        + '— pages 2+ are likely re-serving page 1; the config was not cached, the walk\'s items are planned',
      ],
    }));
    expect(result).toEqual([{
      severity: 'pagination',
      title: 'Pagination looks broken',
      detail: 'Pagination looks broken on this site — pages repeat.',
    }]);
  });

  it('prefers the hub case over the thin-walk case when (implausibly) both warnings are present', () => {
    const result = diagnoseRun(base({
      warnings: [
        'no pagination detected on https://example.com/c/shoes — planned page 1 only',
        'pagination (mechanical: url-pattern) gained only 1 new item(s) on https://example.com/c/shoes '
        + 'where page 1 yielded 8, and the item budget was not what stopped it '
        + '— pages 2+ are likely re-serving page 1; the config was not cached, the walk\'s items are planned',
      ],
    }));
    expect(result).toEqual([{
      severity: 'pagination',
      title: 'No pagination found',
      detail: 'Found some products but no way to reach more pages — hub page, or a single-page listing.',
    }]);
  });
});

describe('diagnoseRun — dead-link', () => {
  it('diagnoses a 404 reason in a plan error', () => {
    // Verbatim fragment from packages/browser/src/page-health.ts's
    // errorPatterns: 'HTTP 404 Not Found — page does not exist'.
    const result = diagnoseRun(base({
      errors: [{ message: 'listing capture failed: HTTP 404 Not Found — page does not exist' }],
    }));
    expect(result).toEqual([{
      severity: 'dead-link',
      title: 'Link appears dead',
      detail: 'The link appears dead (listing capture failed: HTTP 404 Not Found — page does not exist).',
    }]);
  });

  it('diagnoses a "Not Found" fragment in an item failure', () => {
    const result = diagnoseRun(base({
      itemFailures: [{ url: 'https://example.com/p/9', error: 'Soft 404 — page title indicates error or not found' }],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('dead-link');
  });

  // Ruling R4: extraction-orchestrator.ts wraps EVERY checkPageHealth failure
  // — including a 404 — in "Page blocked or unusable: ...". Without unwrapping
  // that prefix first, this would misclassify as `blocked`.
  it('unwraps a "Page blocked or unusable" 404 to dead-link, not blocked', () => {
    const result = diagnoseRun(base({
      itemFailures: [
        { url: 'https://example.com/p/9', error: 'Page blocked or unusable: HTTP 404 Not Found — page does not exist' },
      ],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('dead-link');
    expect(result[0]!.detail).toContain('Page blocked or unusable: HTTP 404 Not Found — page does not exist');
  });
});

describe('diagnoseRun — extraction', () => {
  it('reports every sample item failure verbatim, one entry per item', () => {
    const result = diagnoseRun(base({
      itemFailures: [
        { url: 'https://example.com/p/1', error: 'timeout waiting for selector .price' },
        { url: 'https://example.com/p/2', error: 'confidence below threshold' },
      ],
    }));
    expect(result).toEqual([
      { severity: 'extraction', title: 'https://example.com/p/1', detail: 'timeout waiting for selector .price' },
      { severity: 'extraction', title: 'https://example.com/p/2', detail: 'confidence below threshold' },
    ]);
  });

  it('skips items with no error (successful samples)', () => {
    const result = diagnoseRun(base({
      itemFailures: [
        { url: 'https://example.com/p/1', error: null },
        { url: 'https://example.com/p/2', error: 'boom' },
      ],
    }));
    expect(result).toEqual([{ severity: 'extraction', title: 'https://example.com/p/2', detail: 'boom' }]);
  });

  it('returns [] when every sample item succeeded', () => {
    const result = diagnoseRun(base({
      itemFailures: [{ url: 'https://example.com/p/1', error: null }],
    }));
    expect(result).toEqual([]);
  });
});

describe('diagnoseRun — ordering across categories', () => {
  it('blocked outranks pagination when both are present', () => {
    const result = diagnoseRun(base({
      blockedReason: 'CAPTCHA detected — site requires human verification',
      warnings: ['no pagination detected on https://example.com/c/shoes — planned page 1 only'],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('blocked');
  });

  it('pagination outranks extraction when both are present', () => {
    const result = diagnoseRun(base({
      warnings: ['no pagination detected on https://example.com/c/shoes — planned page 1 only'],
      itemFailures: [{ url: 'https://example.com/p/1', error: 'timeout waiting for selector .price' }],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('pagination');
  });

  it('wrong-page outranks dead-link when both are present', () => {
    const result = diagnoseRun(base({
      rowsFound: 0,
      errors: [{ message: 'listing capture failed: HTTP 404 Not Found — page does not exist' }],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('wrong-page');
  });
});
