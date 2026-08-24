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
    // Assert the STATEMENT, not a comment marker. A marker-only assertion lets
    // someone delete the clearing line and keep the suite green — the recycle
    // fixture would then quietly stop reproducing a virtualized list, and the
    // one test that proves labels are not load-bearing would prove nothing.
    expect(scrollFixturePage({ batches: [['/p/100001']], recycle: true }))
      .toContain("results.innerHTML = ''");
    expect(scrollFixturePage({ batches: [['/p/100001']] }))
      .not.toContain("results.innerHTML = ''");
    // And the re-render that follows the clear. Clearing alone is a list that
    // SHRINKS, not a virtualized one: the cards would be gone for good and the
    // Tier 1 test asserting the walk still sees them could not pass for any
    // implementation. The two statements only mean "virtualized" together.
    expect(scrollFixturePage({ batches: [['/p/100001']], recycle: true }))
      .toContain('batch = rendered');
    expect(scrollFixturePage({ batches: [['/p/100001']] }))
      .not.toContain('batch = rendered');
  });

  it('stamps every generated card with the attribute later tasks select on', () => {
    // Task 3's xpath, Task 4's stamping and Task 5's extraction all key off
    // `data-row`. Nothing asserted it, so renaming it would break three later
    // tasks with no test pointing at the cause.
    expect(scrollFixturePage({ batches: [['/p/100001'], ['/p/100002']], endless: false }))
      .toContain('data-row');
    expect(loadMoreFixturePage({ batches: [['/p/100001']] })).toContain('data-row');
  });

  it('builds an endless page that keeps appending', () => {
    // `endless` was referenced by no test at all, so the branch that Task 4's
    // MAX_SCROLL_ROUNDS bound depends on could have been deleted silently.
    const endless = scrollFixturePage({ batches: [['/p/100001']], endless: true });
    expect(endless).toContain('const endless = true');
    expect(scrollFixturePage({ batches: [['/p/100001']] })).toContain('const endless = false');
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
    //
    // Assert the GUARD as well as the call. `toContain('remove()')` alone
    // survives `if (false) btn.remove()` and survives an off-by-one in the
    // threshold — both of which would break the Tier 1 ending test while this
    // one stayed green.
    const html = loadMoreFixturePage({ batches: [['/p/100001'], ['/p/100002']] });
    expect(html).toContain('served >= rest.length');
    expect(html).toContain('btn.remove()');
  });
});
