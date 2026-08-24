import { describe, it, expect } from 'vitest';
import { scrollFixturePage, loadMoreFixturePage } from './serve.js';

describe('scrollFixturePage', () => {
  it('renders the first batch and nothing else up front', () => {
    const html = scrollFixturePage({ batches: [['/p/100001', '/p/100002'], ['/p/100003']] });
    expect(html).toContain('/p/100001');
    // Later batches must live in the script as data, not in the initial markup —
    // otherwise a crawler that never scrolls would still "find" them and the
    // Tier 1 gate would pass without the scroll loop working at all.
    expect(html.split('<script')[0]).not.toContain('/p/100003');
  });

  it('embeds the remaining batches as data for the scroll handler', () => {
    const html = scrollFixturePage({ batches: [['/p/100001'], ['/p/100003']] });
    expect(html).toContain(JSON.stringify([['/p/100003']]));
  });

  it('can be told to recycle off-screen cards, for the virtualized case', () => {
    expect(scrollFixturePage({ batches: [['/p/100001']], recycle: true })).toContain('RECYCLE');
    expect(scrollFixturePage({ batches: [['/p/100001']] })).not.toContain('RECYCLE');
  });
});

describe('loadMoreFixturePage', () => {
  it('renders a button whose text the heuristic will match', () => {
    expect(loadMoreFixturePage({ batches: [['/p/100001'], ['/p/100002']] }))
      .toContain('Load more');
  });

  it('removes the button when the last batch is served', () => {
    // A button that disappears is the clean end signal; the fixture has to
    // actually do it, or the Tier 1 test for that ending proves nothing.
    expect(loadMoreFixturePage({ batches: [['/p/100001']] })).toContain('remove()');
  });
});
