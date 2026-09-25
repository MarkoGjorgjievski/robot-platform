import { describe, expect, it } from 'vitest';
import {
  MAX_LISTING_PAGES,
  MAX_PRODUCT_URLS,
  appendUrls,
  budgetIsLegacy,
  completeRowCount,
  csvUrlCells,
  emptyCellCounts,
  extractGate,
  hostOf,
  isProbeMoving,
  pagesAreSaved,
  parseRunWarnings,
  productCountsSentence,
  runProgressLine,
  sampleGate,
  saveNote,
  storedMode,
  stripCells,
  tooManyMessage,
  withEditing,
} from './extract-screen-view';
import { budgetFromForm, budgetNeedsSave, budgetToForm } from './extract-view';
import type { RunCounts } from './run-progress';
import type { StepState } from './extract-view';

const counts = (over: Partial<RunCounts> = {}): RunCounts => ({
  pending: 0,
  running: 0,
  done: 0,
  failed: 0,
  listing: 1,
  detail: 40,
  ...over,
});

describe('parseRunWarnings', () => {
  it('recovers the original warning strings, not the prefixed log lines', () => {
    // What probeEvidence's regexes were written against: the plain text, with
    // `warning: ` stripped back off.
    const logs = [
      'warning: pagination (link-rel: next-link) gained only 2 new item(s)',
      'error: input 0: could not fetch https://shop.example/x',
      'warning: no pagination detected on https://shop.example — planned page 1 only',
    ].join('\n');
    expect(parseRunWarnings(logs)).toEqual([
      'pagination (link-rel: next-link) gained only 2 new item(s)',
      'no pagination detected on https://shop.example — planned page 1 only',
    ]);
  });

  it('is empty for a run with no log at all', () => {
    expect(parseRunWarnings(null)).toEqual([]);
    expect(parseRunWarnings(undefined)).toEqual([]);
    expect(parseRunWarnings('')).toEqual([]);
  });
});

describe('hostOf', () => {
  it('reads the hostname, and says nothing rather than guessing', () => {
    expect(hostOf('https://shop.example/p/1')).toBe('shop.example');
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf(null)).toBeNull();
    expect(hostOf(undefined)).toBeNull();
  });
});

describe('withEditing', () => {
  const states: [StepState, StepState, StepState] = ['done', 'done', 'current'];

  it('leaves the stepper alone when nothing is being edited', () => {
    expect(withEditing(states, null)).toEqual(states);
  });

  it('reopens one section and puts every later one back out of reach', () => {
    // A step's evidence is only as good as the step before it: reopening Pages
    // cannot leave Run claiming it is ready on a sample of the old pages.
    expect(withEditing(states, 1)).toEqual(['current', 'later', 'later']);
  });

  it('keeps the sections before the edited one as they were', () => {
    expect(withEditing(states, 2)).toEqual(['done', 'current', 'later']);
  });
});

describe('isProbeMoving', () => {
  it('covers the whole pre-loop lifecycle, not just the active statuses', () => {
    // `planning` is the one that matters: a sample observed while its plan is
    // being built would otherwise never start polling at all.
    expect(isProbeMoving('planning')).toBe(true);
    expect(isProbeMoving('planned')).toBe(true);
    expect(isProbeMoving('extracting')).toBe(true);
    expect(isProbeMoving('cancelling')).toBe(true);
  });

  it('stops at a settled run', () => {
    expect(isProbeMoving('completed')).toBe(false);
    expect(isProbeMoving('partial')).toBe(false);
    expect(isProbeMoving('failed')).toBe(false);
  });
});

describe('storedMode', () => {
  it('takes this tab\'s own marker when there is one', () => {
    expect(storedMode({ inputMode: 'detail', listingMode: 'listing_to_detail', savedCount: 2 })).toBe('detail');
  });

  it('reads a website that predates the tab off its listing mode', () => {
    // The defect this exists for: Acne / Ikea has one saved listing page and no
    // marker, and read "Save your pages first" two lines under a row labelled
    // "saved".
    expect(storedMode({ inputMode: undefined, listingMode: 'listing_to_detail', savedCount: 1 })).toBe('listing');
    expect(storedMode({ inputMode: undefined, listingMode: 'detail', savedCount: 2 })).toBe('detail');
  });

  it('answers null when a shape was chosen but nothing was stored under it', () => {
    // `detail` with no rows has stored nothing and has no listing page standing
    // in for the choice either. (`listing_to_detail` still answers 'listing':
    // `pagesAreSaved`'s own `savedCount > 0` is what holds the gates shut.)
    expect(storedMode({ inputMode: undefined, listingMode: 'detail', savedCount: 0 })).toBeNull();
    expect(storedMode({ inputMode: null, listingMode: null, savedCount: 3 })).toBeNull();
  });

  it('keeps the gates shut for a listing website with no page saved yet', () => {
    const mode = storedMode({ inputMode: undefined, listingMode: 'listing_to_detail', savedCount: 0 });
    expect(pagesAreSaved({ savedCount: 0, savedMode: mode, mode: 'listing', editing: null })).toBe(false);
  });
});

describe('budgetIsLegacy', () => {
  const STARTER = { max_items: 40, max_pages: 3, mode: 'first_n' } as const;

  it('is true only while neither marker is on the row', () => {
    expect(budgetIsLegacy({ inputMode: null, budgetChosen: undefined })).toBe(true);
    expect(budgetIsLegacy({ inputMode: 'listing', budgetChosen: undefined })).toBe(false);
    expect(budgetIsLegacy({ inputMode: null, budgetChosen: true })).toBe(false);
    // Anything but `true` is not the marker: `sources.update` writes the
    // boolean, and a stray falsy value must not certify a budget.
    expect(budgetIsLegacy({ inputMode: null, budgetChosen: false })).toBe(true);
  });

  it('keeps a 40/3 saved on the Settings tab, and asks for no rewrite of it', () => {
    // The seam Important 2 lived in: Settings writes the budget through
    // `sources.update`, which sets `budgetChosen` and no `inputMode`. The
    // Extract tab used to seed all/all from that row and then write all/all
    // back over the customer's 40 on the next Extract click.
    const legacy = budgetIsLegacy({ inputMode: null, budgetChosen: true });
    const form = budgetToForm(STARTER, { legacy });
    expect(form).toEqual({ items: 40, pages: 3 });
    expect(budgetNeedsSave(STARTER, budgetFromForm(form.items, form.pages))).toBe(false);
  });

  it('still reads the old flow\'s own 40/3 as nobody\'s choice', () => {
    const legacy = budgetIsLegacy({ inputMode: null, budgetChosen: undefined });
    expect(budgetToForm(STARTER, { legacy })).toEqual({ items: 'all', pages: 'all' });
  });
});

describe('pagesAreSaved', () => {
  const saved = { savedCount: 3, savedMode: 'listing' as const, mode: 'listing' as const, editing: null };

  it('is true for a stored input set the screen is showing', () => {
    expect(pagesAreSaved(saved)).toBe(true);
  });

  it('is false before anything was ever saved', () => {
    expect(pagesAreSaved({ ...saved, savedCount: 0 })).toBe(false);
    // `savedMode` is `storedMode`'s answer, so `null` here means nothing is
    // stored at all — not merely that this tab was not the one to store it.
    expect(pagesAreSaved({ ...saved, savedMode: null })).toBe(false);
  });

  it('is false the moment the segmented control moves to the other shape', () => {
    // Nothing is saved *for that shape*, and Extract would otherwise plan
    // against the input still stored for the one just navigated away from.
    expect(pagesAreSaved({ ...saved, mode: 'detail' })).toBe(false);
  });

  it('is false while "Edit pages" has section 1 reopened', () => {
    // The same misfire through the other door: with different pages pasted into
    // a reopened section, a "saved" here would leave Extract live and spend a
    // real crawl on the input set the screen is no longer showing.
    expect(pagesAreSaved({ ...saved, editing: 1 })).toBe(false);
  });

  it('is what both gates then read, so neither offers a step the pages cannot back', () => {
    const editing = { ...saved, editing: 1 };
    const green = true;
    expect(sampleGate({ green, pagesSaved: pagesAreSaved(editing) })).toBe('Save your pages first');
    expect(extractGate({ green, pagesSaved: pagesAreSaved(editing), mode: 'listing', sampleDone: true })).toBe(
      'Save your pages first',
    );
  });
});

describe('extractGate', () => {
  const ok = { green: true, pagesSaved: true, mode: 'listing' as const, sampleDone: true };

  it('lets a green, saved, sampled listing website run', () => {
    expect(extractGate(ok)).toBeNull();
  });

  it('names the schema first — nothing below it matters until it is green', () => {
    expect(extractGate({ ...ok, green: false, pagesSaved: false, sampleDone: false })).toBe(
      'Verify every field on the Verification tab first',
    );
  });

  it('asks for a shape before it asks for pages', () => {
    expect(extractGate({ ...ok, mode: null, pagesSaved: false })).toBe('Choose where the products come from');
  });

  it('says pages or URLs, whichever the customer is actually looking at', () => {
    expect(extractGate({ ...ok, pagesSaved: false })).toBe('Save your pages first');
    expect(extractGate({ ...ok, mode: 'detail', pagesSaved: false })).toBe('Save your URLs first');
  });

  it('asks a listing website for its sample, and a product-URL one for nothing', () => {
    expect(extractGate({ ...ok, sampleDone: false })).toBe('Sample first');
    // A fixed list of product pages has nothing to prove: the pages are known.
    expect(extractGate({ ...ok, mode: 'detail', sampleDone: false })).toBeNull();
  });
});

describe('sampleGate', () => {
  it('needs a green schema and saved pages, and says which is missing', () => {
    expect(sampleGate({ green: false, pagesSaved: true })).toBe('Verify every field on the Verification tab first');
    expect(sampleGate({ green: true, pagesSaved: false })).toBe('Save your pages first');
    expect(sampleGate({ green: true, pagesSaved: true })).toBeNull();
  });
});

describe('stripCells', () => {
  const states: [StepState, StepState, StepState] = ['done', 'current', 'later'];

  it('says what each step knows rather than repeating its title', () => {
    const [pages, sample, run] = stripCells({
      states,
      mode: 'listing',
      pageCount: 3,
      sampleRows: null,
      runLabel: null,
    });
    expect(pages.detail).toBe('3 listing pages');
    expect(sample.detail).toBe('not run yet');
    expect(run.detail).toBe('not started');
  });

  it('counts in the words of the shape that is chosen', () => {
    const [pages, sample] = stripCells({
      states,
      mode: 'detail',
      pageCount: 1,
      sampleRows: null,
      runLabel: null,
    });
    expect(pages.detail).toBe('1 product URL');
    expect(sample.detail).toBe('not needed, the pages are known');
  });

  it('reports the sample it has and the run it started', () => {
    const [, sample, run] = stripCells({
      states,
      mode: 'listing',
      pageCount: 2,
      sampleRows: 3,
      runLabel: 'Extracting · 12 of 40',
    });
    expect(sample.detail).toBe('3 rows extracted');
    expect(run.detail).toBe('Extracting · 12 of 40');
  });

  it('carries the reason each out-of-reach step shows in place of its detail', () => {
    const [, sample, run] = stripCells({
      states,
      mode: 'listing',
      pageCount: 0,
      sampleRows: null,
      runLabel: null,
    });
    expect(sample.reason).toBe('Save your pages first');
    expect(run.reason).toBe('Sample first');
    expect(stripCells({ states, mode: 'detail', pageCount: 0, sampleRows: null, runLabel: null })[2].reason).toBe(
      'Save your URLs first',
    );
  });

  it('numbers and titles the three steps in order', () => {
    const cells = stripCells({ states, mode: null, pageCount: 0, sampleRows: null, runLabel: null });
    expect(cells.map((c) => `${c.n} ${c.title}`)).toEqual(['1 Pages', '2 Sample', '3 Run']);
    expect(cells[0]!.detail).toBe('not chosen yet');
  });

  it('asks for a shape before it asks for a sample, exactly as the Extract button does', () => {
    // "Sample first" on a website whose shape nobody has chosen presumes the
    // listing one, and two steps of the same screen must not name two
    // different next steps.
    const [, sample, run] = stripCells({ states, mode: null, pageCount: 0, sampleRows: null, runLabel: null });
    expect(sample.reason).toBe('Choose where the products come from');
    expect(run.reason).toBe('Choose where the products come from');
  });
});

describe('runProgressLine', () => {
  it('spins while the run is being started and nothing has come back yet', () => {
    expect(runProgressLine(null)).toEqual({ label: 'Starting…', dot: 'running' });
  });

  it('counts the work while the loop is moving', () => {
    expect(runProgressLine({ status: 'extracting', counts: counts({ done: 12 }) })).toEqual({
      label: 'Extracting · 12 of 40',
      dot: 'running',
    });
  });

  it('uses the run page’s own wording once the run has settled — and stops pulsing', () => {
    // The finished run's line stays on screen (nothing disappears), so a dot
    // still pulsing beside it would read as work that is still going on.
    expect(runProgressLine({ status: 'completed', counts: counts({ done: 40 }) })).toEqual({
      label: '40 of 40 extracted',
      dot: 'done',
    });
    expect(runProgressLine({ status: 'partial', counts: counts({ done: 38, failed: 2 }) })).toEqual({
      label: '38 of 40 extracted · 2 failed',
      dot: 'partial',
    });
  });

  it('treats a planned-but-idle run as work still owed', () => {
    expect(runProgressLine({ status: 'planned', counts: counts({ pending: 40 }) })).toEqual({
      label: '40 URLs planned, not yet extracted',
      dot: 'running',
    });
  });
});

describe('saveNote', () => {
  it('says nothing when everything was saved', () => {
    expect(saveNote({ skipped: 0, invalid: 0 })).toBeNull();
  });

  it('reports both kinds of loss, in one sentence each', () => {
    expect(saveNote({ skipped: 1, invalid: 0 })).toBe('1 URL is off this website, so it was skipped.');
    expect(saveNote({ skipped: 2, invalid: 0 })).toBe('2 URLs are off this website, so they were skipped.');
    expect(saveNote({ skipped: 0, invalid: 1 })).toBe('1 line was not a URL and was left out.');
    expect(saveNote({ skipped: 2, invalid: 3 })).toBe(
      '2 URLs are off this website, so they were skipped. 3 lines were not URLs and were left out.',
    );
  });
});

describe('productCountsSentence', () => {
  it('states the total on its own when there is nothing else to say', () => {
    expect(productCountsSentence({ total: 0, proof: 0, offHost: 0 })).toBe('0 URLs.');
    expect(productCountsSentence({ total: 1, proof: 0, offHost: 0 })).toBe('1 URL.');
  });

  it('adds the proof pages and the off-host ones, as sentences rather than a dot chain', () => {
    expect(productCountsSentence({ total: 5, proof: 1, offHost: 1 })).toBe(
      '5 URLs. 1 is a proof page. 1 is off this website and will be skipped.',
    );
    expect(productCountsSentence({ total: 9, proof: 3, offHost: 2 })).toBe(
      '9 URLs. 3 are the proof pages. 2 are off this website and will be skipped.',
    );
  });
});

describe('tooManyMessage', () => {
  it('stays quiet inside the server’s own bounds', () => {
    expect(tooManyMessage('listing', MAX_LISTING_PAGES)).toBeNull();
    expect(tooManyMessage('detail', MAX_PRODUCT_URLS)).toBeNull();
  });

  it('says the limit in words before a Zod issue naming an array index can', () => {
    expect(tooManyMessage('listing', 51)).toBe(
      'That is 51 listing pages; 50 is the most a website can have. Remove some and save again.',
    );
    expect(tooManyMessage('detail', 5001)).toBe(
      'That is 5,001 URLs; 5,000 is the most a website can have. Remove some and save again.',
    );
  });
});

describe('csvUrlCells', () => {
  it('takes the url column when the file has a header', () => {
    const table = [
      ['name', 'url'],
      ['One', 'https://shop.example/1'],
      ['Two', 'https://shop.example/2'],
    ];
    expect(csvUrlCells(table)).toEqual({ cells: ['https://shop.example/1', 'https://shop.example/2'] });
  });

  it('accepts the commonest export of all: one column, no header', () => {
    const table = [['https://shop.example/1'], ['https://shop.example/2']];
    expect(csvUrlCells(table)).toEqual({ cells: ['https://shop.example/1', 'https://shop.example/2'] });
  });

  it('refuses anything else by name instead of importing the wrong column', () => {
    const result = csvUrlCells([
      ['name', 'price'],
      ['One', '10.00'],
    ]);
    expect(result).toEqual({ error: 'That file needs a "url" column, or one column of URLs and no header row.' });
  });
});

describe('appendUrls', () => {
  it('fills an empty box', () => {
    expect(appendUrls('', ['a', 'b'])).toBe('a\nb');
    expect(appendUrls('   \n', ['a'])).toBe('a');
  });

  it('adds to what is already there without gluing two URLs together', () => {
    expect(appendUrls('x\n\n', ['y'])).toBe('x\ny');
    expect(appendUrls('x', ['y'])).toBe('x\ny');
  });
});

describe('emptyCellCounts', () => {
  const columns = [
    { key: 'title', name: 'Title' },
    { key: 'price', name: 'Price' },
  ];

  it('counts every column that came back empty on at least one row', () => {
    const rows = [
      { title: 'A', price: '10' },
      { title: 'B', price: '' },
      { title: 'C', price: null },
    ];
    expect(emptyCellCounts(rows, columns)).toEqual([{ name: 'Price', emptyOn: 2, sampled: 3 }]);
  });

  it('says nothing about a sample that produced no rows, or a column that filled every time', () => {
    expect(emptyCellCounts([], columns)).toEqual([]);
    expect(emptyCellCounts([{ title: 'A', price: '10' }], columns)).toEqual([]);
  });

  it('names the field the way the customer named it, not by its key', () => {
    // A note reading "price_currency was empty on 2 of 3 sampled pages" leaks
    // a key nobody chose.
    const [note] = emptyCellCounts([{ price: '' }], [{ key: 'price_currency', name: 'Currency' }]);
    expect(note?.name).toBe('Currency');
  });
});

describe('completeRowCount', () => {
  it('counts only the rows with every contract column filled', () => {
    const columns = [{ key: 'title' }, { key: 'price' }];
    const rows = [
      { title: 'A', price: '10' },
      { title: 'B', price: '' },
      { title: 'C' },
    ];
    expect(completeRowCount(rows, columns)).toBe(1);
  });
});
