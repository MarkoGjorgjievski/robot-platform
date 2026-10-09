import { describe, it, expect } from 'vitest';
import {
  answer, answerFromSuggestion, badge, boardFrom, canSave, pointable, MIN_BOX_SIDE, productsProblem, dropCard, emptyBoard, fieldsFor, liveSuggestions, mergeSuggestions, reverifyScope,
  segment, setCards, shortUrl, toBindingInput, validateValue, valueFromBox, verifyGate, type Board, type Box, type Field,
  acceptAllAgreed, acceptRow, rowStatus, sameValue, type RowStatus, cellLabel, verifyReason,
  failsText, displayValue, pickAnswer, cellAcceptable, carryFrom,
} from './verification-model';

const U = ['https://s.example/p/1', 'https://s.example/p/2', 'https://s.example/p/3'];
const FIELDS: Field[] = [
  { key: 'title', name: 'Title', type: 'text', description: 'heading' },
  { key: 'price', name: 'Price', type: 'money', description: 'price' },
];
const MARK = { xpaths: ['//h1'], text: 'Widget A', rect: { x: 0, y: 0, w: 10, h: 10 } };
const board = (): Board => ({ ...emptyBoard(), cards: U.map((url, i) => ({ url, title: `W${i + 1}` })), descriptions: { title: 'heading', price: 'price' } });
const box = (o: Partial<Box>): Box => ({ xpaths: ['//x'], text: '', rect: { x: 0, y: 0, w: 1, h: 1 }, tag: 'span', kind: 'text', ...o });
const full = () => {
  let b = board();
  for (const u of U) { b = answer(b, 'title', u, { value: 'W', mark: MARK }); b = answer(b, 'price', u, { value: '1.00', mark: null }); }
  return b;
};

describe('the board and its save', () => {
  it('saves cards, descriptions, values and marks as a draft', () => {
    const b = answer(board(), 'title', U[0]!, { value: 'Widget A', mark: MARK });
    const input = toBindingInput(b, FIELDS);
    expect(input).toMatchObject({ urls: U, draft: true, descriptions: { title: 'heading', price: 'price' }, marks: { title: { [U[0]!]: MARK } } });
    expect(input.expected.title).toEqual({ [U[0]!]: 'Widget A', [U[1]!]: '', [U[2]!]: '' });
    expect(input.cards).toHaveLength(3);
  });
  it('reads a saved record back, cards included, and falls back to a card per url without them', () => {
    const b = answer(board(), 'title', U[0]!, { value: 'Widget A', mark: MARK });
    const i = toBindingInput(b, FIELDS);
    const back = boardFrom({ schemaDefinition: FIELDS, verificationSet: { urls: i.urls, expected: i.expected, marks: i.marks, cards: i.cards } });
    expect(back.answers.title![U[0]!]).toEqual({ value: 'Widget A', mark: MARK });
    expect(back.answers.title![U[1]!]).toBeUndefined();
    expect(boardFrom({ schemaDefinition: FIELDS, verificationSet: { urls: U, expected: {} } }).cards.map((c) => c.title)).toEqual(['/p/1', '/p/2', '/p/3']);
    expect(boardFrom({ schemaDefinition: FIELDS, verificationSet: null })).toEqual({ ...emptyBoard(), descriptions: { title: 'heading', price: 'price' } });
  });
  it('dropping a card takes its answers with it and nothing else', () => {
    let b = answer(answer(board(), 'title', U[0]!, { value: 'A', mark: MARK }), 'title', U[1]!, { value: 'B', mark: MARK });
    b = dropCard(b, 1);
    expect(b.cards.map((c) => c.url)).toEqual([U[0], U[2]]);
    expect(b.answers.title).toEqual({ [U[0]!]: { value: 'A', mark: MARK } });
    expect(JSON.stringify(toBindingInput(b, FIELDS))).not.toContain(U[1]!);
  });
  it('setCards keeps answers for urls still present', () => {
    const b = setCards(answer(board(), 'title', U[0]!, { value: 'A', mark: MARK }), [{ url: U[0]!, title: 'x' }, { url: 'https://s.example/p/9', title: 'y' }]);
    expect(b.answers.title![U[0]!]!.value).toBe('A');
  });
  it('only saves three or more distinct pages on one website', () => {
    expect(canSave(board())).toBe(true);
    expect(canSave({ ...board(), cards: board().cards.slice(0, 2) })).toBe(false);
    expect(canSave({ ...board(), cards: [...board().cards.slice(0, 2), { url: 'https://other.example/p', title: '' }] })).toBe(false);
    expect(canSave({ ...board(), cards: [...board().cards.slice(0, 2), { url: U[0]!, title: '' }] })).toBe(false);
  });
  it('says why the products cannot be saved, or null when they can (fewer than three is the gate’s to say)', () => {
    const cards = board().cards;
    expect(productsProblem(board())).toBeNull();
    expect(productsProblem({ ...board(), cards: cards.slice(0, 2) })).toBeNull();
    expect(productsProblem({ ...board(), cards: [...cards.slice(0, 2), { url: '', title: '' }] })).toBe('Every product needs a page');
    expect(productsProblem({ ...board(), cards: [...cards.slice(0, 2), { url: 'https://other.example/p', title: '' }] })).toBe('All products must be on the same website');
    expect(productsProblem({ ...board(), cards: [...cards.slice(0, 2), { url: `${U[0]!}#x`, title: '' }] })).toBe('Two products are the same page');
    expect(productsProblem({ ...board(), cards: [...cards.slice(0, 2), { url: 'not a url', title: '' }] })).toBe('Fix the products above first');
    const seven = Array.from({ length: 7 }, (_, i) => ({ url: `https://s.example/p/${i}`, title: '' }));
    expect(productsProblem({ ...board(), cards: seven })).toBe('Six products is the most a website is checked on');
    // Whenever canSave is false with three or more cards, there is a reason.
    for (const b of [{ ...board(), cards: [...cards.slice(0, 2), { url: 'ftp://s.example/p', title: '' }] }]) {
      expect(canSave(b)).toBe(false);
      expect(productsProblem(b)).not.toBeNull();
    }
  });
});

describe('a click', () => {
  it('reads text, an image src or a link href by the field type, and says why when it cannot', () => {
    expect(valueFromBox(box({ text: 'Widget A' }), 'text')).toEqual({ value: 'Widget A', mark: { xpaths: ['//x'], text: 'Widget A', rect: { x: 0, y: 0, w: 1, h: 1 } } });
    expect(valueFromBox(box({ kind: 'image', src: 'https://s.example/a.jpg' }), 'image')).toMatchObject({ value: 'https://s.example/a.jpg', mark: { text: '' } });
    expect(valueFromBox(box({ kind: 'link', text: 'Buy', href: 'https://s.example/b' }), 'url')).toMatchObject({ value: 'https://s.example/b', mark: { text: '' } });
    expect(valueFromBox(box({ text: 'x' }), 'image')).toEqual({ error: 'This element is not an image' });
    expect(valueFromBox(box({ text: 'x' }), 'url')).toEqual({ error: 'This element is not a link' });
    expect(valueFromBox(box({ kind: 'image', src: 'x' }), 'text')).toEqual({ error: 'This element has no text' });
    expect(valueFromBox(box({ text: 'x', xpaths: [] }), 'text')).toEqual({ value: 'x', mark: null });
  });
  it('keeps no mark for an element that is not on the screenshot: the server refuses a negative rect', () => {
    // Ikea 2026-09-28: a price-module link measured at y = -1066; its mark made every autosave fail.
    expect(valueFromBox(box({ kind: 'link', href: 'https://s.example/b', rect: { x: 793, y: -1066, w: 77, h: 20 } }), 'url')).toEqual({ value: 'https://s.example/b', mark: null });
    expect(valueFromBox(box({ text: 'x', rect: { x: -3, y: 10, w: 80, h: 20 } }), 'text')).toEqual({ value: 'x', mark: null });
  });
  it('lists fields that fit the element first, and marks the ones already answered here', () => {
    const b = answer(board(), 'title', U[0]!, { value: 'A', mark: MARK });
    const list = fieldsFor(box({ text: '$129.99' }), FIELDS, b, U[0]!);
    expect(list.map((l) => [l.field.key, l.fits, l.answered])).toEqual([['price', true, false], ['title', true, true]]);
    const img = fieldsFor(box({ kind: 'image', src: 'https://s.example/a.jpg' }), [...FIELDS, { key: 'img', name: 'Image', type: 'image', description: '' }], board(), U[0]!);
    expect(img[0]!.field.key).toBe('img');
  });
});

describe('ticking a suggestion (final review M1)', () => {
  const PRICE = FIELDS[1]!;
  const TITLE = FIELDS[0]!;
  it('a suggestion fits by its own value, not by the element it sits on', () => {
    // The element reads "Add to basket"; the page data says 12.00 — the tick must be offered.
    const rows = fieldsFor(box({ text: 'Add to basket' }), FIELDS, board(), U[0]!, { key: 'price', value: '12.00' });
    expect(rows.find((r) => r.field.key === 'price')!.fits).toBe(true);
    // And a suggestion whose value does not fit is not tickable, whatever the element says.
    const bad = fieldsFor(box({ text: '$5.00' }), FIELDS, board(), U[0]!, { key: 'price', value: 'call us' });
    expect(bad.find((r) => r.field.key === 'price')!.fits).toBe(false);
  });
  it('keeps the element as the mark only when it shows the suggested value (the server’s comparison)', () => {
    const a = answerFromSuggestion(box({ text: '£12.00' }), PRICE, '12', U[0]!);
    expect(a.value).toBe('12');
    expect(a.mark).not.toBeNull();
    expect(answerFromSuggestion(box({ text: '  widget a ' }), TITLE, 'Widget A', U[0]!).mark).not.toBeNull();
  });
  it('stores the value alone when the element shows something else, as the server would keep it: what shows before a reload shows after', () => {
    expect(answerFromSuggestion(box({ text: 'Add to basket' }), PRICE, '12.00', U[0]!)).toEqual({ value: '12.00', mark: null });
    expect(answerFromSuggestion(box({ text: 'Widget A deluxe' }), TITLE, 'Widget A', U[0]!)).toEqual({ value: 'Widget A', mark: null });
    expect(answerFromSuggestion(box({ kind: 'image', src: 'x' }), PRICE, '12.00', U[0]!)).toEqual({ value: '12.00', mark: null });
  });
});

describe('suggestions', () => {
  it('never offers over an answer, and forgets suggestions from a replaced capture', () => {
    const b = answer(board(), 'title', U[0]!, { value: 'A', mark: MARK });
    let s = mergeSuggestions({}, { title: { value: 'Widget A', boxes: [0] }, price: { value: '129.99', boxes: [1] } }, U[0]!, 'cap-1', 'page-data', b);
    expect(s.title).toBeUndefined();
    expect(s.price![U[0]!]).toEqual({ captureId: 'cap-1', value: '129.99', boxes: [1], origin: 'page-data' });
    expect(liveSuggestions(s, b, { [U[0]!]: 'cap-1' }).price![U[0]!]).toBeDefined();
    expect(liveSuggestions(s, b, { [U[0]!]: 'cap-2' }).price?.[U[0]!]).toBeUndefined();
    s = mergeSuggestions(s, { price: null }, U[0]!, 'cap-1', 'page-data', b);
    expect(s.price![U[0]!]).toBeDefined(); // a null answer adds nothing and removes nothing
  });
});

describe('pointable', () => {
  // Found in the plan 5 live run on Ikea: Product URL was suggested on an
  // anchor whose box is 1×1 — a label on the screenshot with nothing under it
  // a customer could click.
  const boxes = [
    box({ rect: { x: 0, y: 0, w: 1, h: 1 } }),
    box({ rect: { x: 10, y: 10, w: 80, h: 20 } }),
    box({ rect: { x: 0, y: 40, w: MIN_BOX_SIDE, h: MIN_BOX_SIDE } }),
    box({ rect: { x: 0, y: 60, w: 300, h: MIN_BOX_SIDE - 1 } }),
  ];
  it('keeps the elements big enough to click, in order', () => {
    expect(pointable(boxes, [0, 1, 2, 3])).toEqual([1, 2]);
  });
  it('drops an index the box map does not have', () => {
    expect(pointable(boxes, [1, 9])).toEqual([1]);
  });
  it('drops an element that starts above or left of the screenshot', () => {
    // Ikea 2026-09-28: Product URL's one link sat at y = -1066 — not on the
    // screenshot, and its rect is refused by the server as a mark.
    const off = [box({ rect: { x: 793, y: -1066, w: 77, h: 20 } }), box({ rect: { x: -3, y: 10, w: 80, h: 20 } }), box({ rect: { x: 10, y: 10, w: 80, h: 20 } })];
    expect(pointable(off, [0, 1, 2])).toEqual([2]);
  });
});

describe('the battery and the badge', () => {
  it('reads each segment', () => {
    const b = answer(board(), 'title', U[0]!, { value: 'A', mark: MARK });
    const s = mergeSuggestions({}, { title: { value: 'B', boxes: [0] } }, U[1]!, 'c', 'from-product', b);
    expect(segment(b, s, 'title', U[0]!, { failed: false })).toBe('answered');
    expect(segment(b, s, 'title', U[1]!, { failed: false })).toBe('suggested');
    expect(segment(b, s, 'title', U[2]!, { failed: false })).toBe('empty');
    expect(segment(b, s, 'title', U[0]!, { failed: true })).toBe('failed');
  });
  it('says verified, fails on product n, changed, or checking', () => {
    const results = { title: { certified: [{}], cells: { [U[0]!]: { status: 'pass' as const } } }, price: { certified: [], cells: { [U[0]!]: { status: 'pass' as const }, [U[1]!]: { status: 'fail' as const } } } };
    const cards = board().cards;
    expect(badge({ key: 'title', results, unchangedKeys: ['title', 'price'], running: false, cards })).toEqual({ kind: 'verified' });
    expect(badge({ key: 'price', results, unchangedKeys: ['title', 'price'], running: false, cards })).toEqual({ kind: 'fails', products: [2] });
    expect(badge({ key: 'title', results, unchangedKeys: [], running: false, cards })).toEqual({ kind: 'changed' });
    expect(badge({ key: 'title', results, unchangedKeys: [], running: true, cards })).toEqual({ kind: 'checking' });
    expect(badge({ key: 'title', results: null, unchangedKeys: [], running: false, cards })).toBeNull();
  });
  it('a field that failed and has not changed since reads fails on product n, not changed (it is never current)', () => {
    const results = { price: { certified: [], cells: { [U[0]!]: { status: 'pass' as const }, [U[1]!]: { status: 'fail' as const }, [U[2]!]: { status: 'pass' as const } } } };
    const two = { price: { certified: [], cells: { [U[0]!]: { status: 'fail' as const }, [U[1]!]: { status: 'pass' as const }, [U[2]!]: { status: 'fail' as const } } } };
    expect(badge({ key: 'price', results: two, unchangedKeys: ['price'], running: false, cards: board().cards })).toEqual({ kind: 'fails', products: [1, 3] });
    expect(badge({ key: 'price', results, unchangedKeys: ['price'], running: false, cards: board().cards })).toEqual({ kind: 'fails', products: [2] });
    expect(badge({ key: 'price', results, unchangedKeys: [], running: false, cards: board().cards })).toEqual({ kind: 'changed' });
  });
});

describe('the Verify gate', () => {
  it('names the first gap on products 1 to 3', () => {
    expect(verifyGate(board(), FIELDS, {})).toEqual({ ok: false, reason: 'Title still needs product 1', gap: 'title' });
    expect(verifyGate(full(), FIELDS, {})).toEqual({ ok: true });
  });
  it('refuses a value of the wrong type', () => {
    const b = answer(full(), 'price', U[1]!, { value: 'free', mark: null });
    expect(verifyGate(b, FIELDS, {})).toEqual({ ok: false, reason: 'Price on product 2: Not a money amount', gap: 'price' });
  });
  it('lets products 4 to 6 stay empty but not suggested, and not wholly empty', () => {
    let b = setCards(full(), [...full().cards, { url: 'https://s.example/p/4', title: 'W4' }]);
    expect(verifyGate(b, FIELDS, {})).toEqual({ ok: false, reason: 'Product 4 needs at least one field, or drop it' });
    b = answer(b, 'title', 'https://s.example/p/4', { value: 'W', mark: MARK });
    expect(verifyGate(b, FIELDS, {})).toEqual({ ok: true });
    const s = mergeSuggestions({}, { price: { value: '2.00', boxes: [0] } }, 'https://s.example/p/4', 'c', 'from-product', b);
    expect(verifyGate(b, FIELDS, s)).toEqual({ ok: false, reason: 'Price has a suggestion to confirm on product 4', gap: 'price' });
  });
  it('needs three products', () => {
    expect(verifyGate({ ...full(), cards: full().cards.slice(0, 2) }, FIELDS, {})).toEqual({ ok: false, reason: 'Add at least three products' });
  });
});

describe('the Verify gate: descriptors (final review I1)', () => {
  it('refuses a field with no descriptor before any product gap, naming the field', () => {
    const custom: Field[] = [...FIELDS, { key: 'sku', name: 'SKU', type: 'text', description: '' }];
    let b = full();
    for (const u of U) b = answer(b, 'sku', u, { value: 'A1', mark: null });
    expect(verifyGate(b, custom, {})).toEqual({ ok: false, reason: 'Say where SKU is on this website', field: 'sku' });
    // Before the product gaps, so the reason is the one to act on.
    expect(verifyGate(board(), custom, {})).toEqual({ ok: false, reason: 'Say where SKU is on this website', field: 'sku' });
    // Whitespace is not a descriptor; the board's own text wins over the catalogue's.
    expect(verifyGate({ ...b, descriptions: { ...b.descriptions, sku: '   ' } }, custom, {})).toMatchObject({ ok: false, field: 'sku' });
    expect(verifyGate({ ...b, descriptions: { ...b.descriptions, sku: 'under the title' } }, custom, {})).toEqual({ ok: true });
    expect(verifyGate({ ...b, descriptions: { ...b.descriptions, title: '' } }, custom, {})).toMatchObject({ ok: false, reason: 'Say where Title is on this website' });
  });
});

describe('the listing is on the products’ website (final review I4)', () => {
  it('does not save, and says why, when the listing is on another website', () => {
    const b = { ...board(), listingUrl: 'https://other.example/c/all' };
    expect(canSave(b)).toBe(false);
    expect(productsProblem(b)).toBe('The listing must be on the same website as the products');
  });
  it('saves with a listing on the same website, and with none', () => {
    expect(canSave({ ...board(), listingUrl: 'https://S.example/c/all' })).toBe(true);
    expect(productsProblem({ ...board(), listingUrl: 'https://S.example/c/all' })).toBeNull();
    expect(canSave({ ...board(), listingUrl: '  ' })).toBe(true);
  });
  it('a listing that is not an address blocks the save too, with a reason', () => {
    const b = { ...board(), listingUrl: 'not a url' };
    expect(canSave(b)).toBe(false);
    expect(productsProblem(b)).not.toBeNull();
  });
});

describe('small things', () => {
  it('scopes a re-verify to fields not current, and to everything on a first run', () => {
    expect(reverifyScope(FIELDS, null, [])).toBeUndefined();
    expect(reverifyScope(FIELDS, { title: { certified: [{}], cells: {} } }, ['title'])).toEqual(['price']);
  });
  it('validates by type and shortens urls', () => {
    expect(validateValue('money', '$1,299.00')).toBeNull();
    expect(validateValue('money', 'free')).toBe('Not a money amount');
    expect(validateValue('text', '')).toBe('Expected value is required');
    expect(shortUrl('https://s.example/p/1')).toBe('/p/1');
  });
  it('takes schema.org availability as yes/no, as the engine does', () => {
    // Found in plan 5's live run on Ikea: page data suggested In stock as its
    // JSON-LD value, the tab let it be ticked, and the Verify gate then
    // refused it ("Not yes/no") although the engine reads it fine.
    expect(validateValue('boolean', 'https://schema.org/InStock')).toBeNull();
    expect(validateValue('boolean', 'http://schema.org/OutOfStock')).toBeNull();
    expect(validateValue('boolean', 'https://schema.org/Discontinued')).toBe('Not yes/no (or in stock/out of stock)');
  });
});

const JL = { source: 'json-ld', path: 'offers.price' };
const TL = { source: 'json-ld', path: 'name' };
const API = { source: 'api', path: 'price' };
const boxesOf = (texts: string[]): Box[] => texts.map((t, i) => box({ text: t, rect: { x: 0, y: i * 20, w: 100, h: 16 }, xpaths: [`//x${i}`] }));
const maps = (): Record<string, Box[]> => ({ [U[0]!]: boxesOf(['Widget A', '$129.99']), [U[1]!]: boxesOf(['Widget B', '$219.99']), [U[2]!]: boxesOf(['Widget C', '$149.00']) });
const sug = (value: string, boxes: number[], via?: { source: string; path: string }) => ({ value, boxes, ...(via ? { via } : {}) });
function liveFor(b: Board, key: string, per: Array<ReturnType<typeof sug> | null>) {
  let s = {};
  per.forEach((p, i) => { if (p) s = mergeSuggestions(s, { [key]: p }, U[i]!, `cap-${i}`, 'page-data', b); });
  return liveSuggestions(s, b, { [U[0]!]: 'cap-0', [U[1]!]: 'cap-1', [U[2]!]: 'cap-2' });
}
const price = FIELDS.find((f) => f.key === 'price')!;
const title = FIELDS.find((f) => f.key === 'title')!;

describe('suggestions keep their path', () => {
  it('mergeSuggestions stores via', () => {
    const s = mergeSuggestions({}, { price: sug('129.99', [1], JL) }, U[0]!, 'c', 'page-data', board());
    expect(s.price![U[0]!]!.via).toEqual(JL);
  });
});

describe('rowStatus', () => {
  it('agreed: one place each, valid, same path, different values', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [1], JL), sug('219.99', [1], JL), sug('149.00', [1], JL)]);
    expect(rowStatus(price, b, live, maps())).toEqual<RowStatus>({ kind: 'agreed' });
  });
  it('page data no element shows is not agreed: the row asks for a look at that product', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [], JL), sug('219.99', [1], JL), sug('149.00', [], JL)]);
    expect(rowStatus(price, b, live, maps())).toEqual<RowStatus>({ kind: 'needs-you', reason: 'only in the page data on product 1', product: 1 });
  });
  it('a boxless suggestion wins over "comes from different places"', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [1], JL), sug('219.99', [], API), sug('149.00', [1], JL)]);
    expect(rowStatus(price, b, live, maps())).toEqual<RowStatus>({ kind: 'needs-you', reason: 'only in the page data on product 2', product: 2 });
  });
  it('a value carried from another product that this page does not show is the same case', () => {
    const b = board();
    const carried = { ...sug('219.99', [], JL), origin: 'from-product' as const };
    const live = liveFor(b, 'price', [sug('129.99', [1], JL), carried, sug('149.00', [1], JL)]);
    expect((rowStatus(price, b, live, maps()) as { reason?: string }).reason).toBe('only in the page data on product 2');
  });
  it('an answered product plus suggestions on the rest is still agreed', () => {
    const b = answer(board(), 'price', U[0]!, { value: '129.99', mark: null });
    const live = liveFor(b, 'price', [null, sug('219.99', [1], JL), sug('149.00', [1], JL)]);
    expect(rowStatus(price, b, live, maps()).kind).toBe('agreed');
  });
  it('accepted when every product has an answer', () => {
    let b = board();
    for (const u of U) b = answer(b, 'price', u, { value: '1.00', mark: null });
    expect(rowStatus(price, b, {}, maps())).toEqual({ kind: 'accepted' });
  });
  it('names the first gap, product by product', () => {
    const b = board();
    expect(rowStatus(price, b, liveFor(b, 'price', [sug('129.99', [1], JL), null, sug('149.00', [1], JL)]), maps()))
      .toEqual({ kind: 'needs-you', reason: 'missing on product 2', product: 2 });
    expect(rowStatus(price, b, liveFor(b, 'price', [sug('129.99', [0, 1], JL), sug('219.99', [1], JL), sug('149.00', [1], JL)]), maps()))
      .toEqual({ kind: 'needs-you', reason: 'found in 2 places on product 1', product: 1 });
    expect(rowStatus(price, b, liveFor(b, 'price', [sug('129.99', [1], JL), sug('free', [1], JL), sug('149.00', [1], JL)]), maps()))
      .toEqual({ kind: 'needs-you', reason: 'Not a money amount on product 2', product: 2 });
    const noShot = { ...maps(), [U[2]!]: undefined };
    expect(rowStatus(price, b, liveFor(b, 'price', [sug('129.99', [1], JL), sug('219.99', [1], JL), null]), noShot))
      .toEqual({ kind: 'needs-you', reason: 'screenshot not ready on product 3', product: 3 });
  });
  it('different paths, or a missing path, are not agreement', () => {
    const b = board();
    // Three different paths: no majority (two sharing one is A4's majority, below).
    const mixed = liveFor(b, 'price', [sug('129.99', [1], JL), sug('219.99', [1], { source: 'meta', path: 'product:price:amount' }), sug('149.00', [1], { source: 'api', path: 'price' })]);
    expect(rowStatus(price, b, mixed, maps())).toEqual({ kind: 'needs-you', reason: 'comes from different places' });
    const noVia = liveFor(b, 'price', [sug('129.99', [1]), sug('219.99', [1]), sug('149.00', [1])]);
    expect(rowStatus(price, b, noVia, maps())).toEqual({ kind: 'needs-you', reason: 'comes from different places' });
  });
  it('same-everywhere ignores case and spaces', () => {
    const b = board();
    const live = liveFor(b, 'title', [sug('IKEA', [0], TL), sug('Ikea ', [0], TL), sug('ikea', [0], TL)]);
    expect(rowStatus(title, b, live, maps())).toEqual({ kind: 'same-everywhere' });
    expect(sameValue(' IKEA  AB', 'ikea ab')).toBe(true);
  });
  it('rowStatus ignores stale capture ids (through liveSuggestions)', () => {
    const b = board();
    let s = {};
    U.forEach((u, i) => { s = mergeSuggestions(s, { price: sug(['129.99', '219.99', '149.00'][i]!, [1], JL) }, u, `cap-${i}`, 'page-data', b); });
    const live = liveSuggestions(s, b, { [U[0]!]: 'cap-0', [U[1]!]: 'cap-NEW', [U[2]!]: 'cap-2' });
    expect(rowStatus(price, b, live, maps())).toEqual({ kind: 'needs-you', reason: 'missing on product 2', product: 2 });
  });
  it('products 4 to 6: blank is fine, an invalid or several-place suggestion is not', () => {
    const U4 = 'https://s.example/p/4';
    const b = setCards(board(), [...board().cards, { url: U4, title: 'W4' }]);
    const m = { ...maps(), [U4]: boxesOf(['Widget D', '$1']) };
    const base = [sug('129.99', [1], JL), sug('219.99', [1], JL), sug('149.00', [1], JL)];
    let s = {};
    base.forEach((p, i) => { s = mergeSuggestions(s, { price: p }, U[i]!, `cap-${i}`, 'page-data', b); });
    const ids = { [U[0]!]: 'cap-0', [U[1]!]: 'cap-1', [U[2]!]: 'cap-2', [U4]: 'cap-3' };
    expect(rowStatus(price, b, liveSuggestions(s, b, ids), m).kind).toBe('agreed');
    const bad = mergeSuggestions(s, { price: sug('ask', [1], JL) }, U4, 'cap-3', 'page-data', b);
    expect(rowStatus(price, b, liveSuggestions(bad, b, ids), m)).toEqual({ kind: 'needs-you', reason: 'Not a money amount on product 4', product: 4 });
  });
});

describe('rowStatus: a lone suggestion is not agreement (final review I1)', () => {
  const ids = { [U[0]!]: 'cap-0', [U[1]!]: 'cap-1', [U[2]!]: 'cap-2' };
  const twoAnswered = () => answer(answer(board(), 'price', U[0]!, { value: '129.99', mark: null }), 'price', U[1]!, { value: '219.99', mark: null });

  it('one page-data suggestion left after two answers needs you: check product 3', () => {
    const b = twoAnswered();
    const s = mergeSuggestions({}, { price: sug('149.00', [1], JL) }, U[2]!, 'cap-2', 'page-data', b);
    expect(rowStatus(price, b, liveSuggestions(s, b, ids), maps())).toEqual({ kind: 'needs-you', reason: 'check product 3', product: 3 });
  });
  it('two answers and one suggestion carried from a ticked product is agreed (spec A2 transfer)', () => {
    const b = twoAnswered();
    const s = mergeSuggestions({}, { price: sug('149.00', [1], JL) }, U[2]!, 'cap-2', 'from-product', b);
    expect(rowStatus(price, b, liveSuggestions(s, b, ids), maps())).toEqual({ kind: 'agreed' });
  });
  it('a single filled card with blanks beside it is not agreed', () => {
    const U4 = 'https://s.example/p/4', U5 = 'https://s.example/p/5';
    let b = setCards(board(), [...board().cards, { url: U4, title: 'W4' }, { url: U5, title: 'W5' }]);
    for (const [i, u] of U.entries()) b = answer(b, 'price', u, { value: `${i + 1}.00`, mark: null });
    const s = mergeSuggestions({}, { price: sug('4.00', [1], JL) }, U4, 'cap-3', 'page-data', b);
    const m = { ...maps(), [U4]: boxesOf(['Widget D', '$4.00']), [U5]: boxesOf(['Widget E']) };
    const live = liveSuggestions(s, b, { ...ids, [U4]: 'cap-3', [U5]: 'cap-4' });
    expect(rowStatus(price, b, live, m)).toEqual({ kind: 'needs-you', reason: 'check product 4', product: 4 });
    expect(acceptAllAgreed(b, FIELDS, live, m).accepted).toEqual([]);
  });
});

describe('rowStatus: answered cells and failed screenshots (final review M4, M6)', () => {
  it('an answer that is not valid for the type needs you, not a green rail', () => {
    let b = board();
    b = answer(b, 'price', U[0]!, { value: '1.00', mark: null });
    b = answer(b, 'price', U[1]!, { value: 'abc', mark: null });
    b = answer(b, 'price', U[2]!, { value: '3.00', mark: null });
    expect(rowStatus(price, b, {}, maps())).toEqual({ kind: 'needs-you', reason: 'Not a money amount on product 2', product: 2 });
  });
  it('a failed screenshot says so, a pending one says not ready', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [1], JL), sug('219.99', [1], JL), null]);
    const noShot = { ...maps(), [U[2]!]: undefined };
    expect(rowStatus(price, b, live, noShot, new Set([U[2]!])))
      .toEqual({ kind: 'needs-you', reason: 'screenshot failed on product 3', product: 3 });
    expect(rowStatus(price, b, live, noShot, new Set()))
      .toEqual({ kind: 'needs-you', reason: 'screenshot not ready on product 3', product: 3 });
  });
});

describe('the Verify gate names the field a product gap is about (final review M7)', () => {
  it('a missing answer carries its field key, apart from the descriptor field', () => {
    const b = answer(board(), 'title', U[0]!, { value: 'W', mark: null });
    expect(verifyGate(b, FIELDS, {})).toEqual({ ok: false, reason: 'Price still needs product 1', gap: 'price' });
  });
});

describe('accepting', () => {
  it('acceptRow marks a one-place suggestion by its element and a page-data value as typed', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('$129.99', [1], JL), sug('219.99', [], JL), sug('149.00', [1], JL)]);
    const next = acceptRow(b, price, live, maps());
    expect(next.answers.price![U[0]!]!.mark?.xpaths).toEqual(['//x1']);
    expect(next.answers.price![U[1]!]).toEqual({ value: '219.99', mark: null, via: JL });
  });
  it('acceptAllAgreed only fills agreed rows\' empty cells', () => {
    let b = answer(board(), 'title', U[0]!, { value: 'SAME', mark: null }); // with 'Same' and 'same' below: same-everywhere, so not accepted
    let s = {};
    const add = (key: string, i: number, p: ReturnType<typeof sug>) => { s = mergeSuggestions(s, { [key]: p }, U[i]!, `cap-${i}`, 'page-data', b); };
    add('price', 0, sug('129.99', [1], JL)); add('price', 1, sug('219.99', [1], JL)); add('price', 2, sug('149.00', [1], JL));
    add('title', 1, sug('Same', [0], TL)); add('title', 2, sug('same', [0], TL));
    const live = liveSuggestions(s, b, { [U[0]!]: 'cap-0', [U[1]!]: 'cap-1', [U[2]!]: 'cap-2' });
    const r = acceptAllAgreed(b, FIELDS, live, maps());
    expect(r.accepted).toEqual(['price']);
    expect(r.board.answers.title![U[0]!]).toEqual({ value: 'SAME', mark: null });
    expect(r.board.answers.title![U[1]!]).toBeUndefined();
    b = r.board;
    // A late transfer for an accepted cell is ignored.
    const late = mergeSuggestions(s, { price: sug('999.00', [1], JL) }, U[1]!, 'cap-1', 'from-product', b);
    expect(liveSuggestions(late, b, { [U[0]!]: 'cap-0', [U[1]!]: 'cap-1', [U[2]!]: 'cap-2' }).price).toBeUndefined();
    expect(b.answers.price![U[1]!]!.value).toBe('219.99');
  });
  it('after accepting every agreed row the Verify gate can open', () => {
    let b = board();
    let s = {};
    const add = (key: string, i: number, p: ReturnType<typeof sug>) => { s = mergeSuggestions(s, { [key]: p }, U[i]!, `cap-${i}`, 'page-data', b); };
    ['129.99', '219.99', '149.00'].forEach((v, i) => add('price', i, sug(v, [1], JL)));
    ['Widget A', 'Widget B', 'Widget C'].forEach((v, i) => add('title', i, sug(v, [0], TL)));
    const live = liveSuggestions(s, b, { [U[0]!]: 'cap-0', [U[1]!]: 'cap-1', [U[2]!]: 'cap-2' });
    b = acceptAllAgreed(b, FIELDS, live, maps()).board;
    expect(verifyGate(b, FIELDS, {})).toEqual({ ok: true });
  });
});

describe('what the table and the Verify reason say (final review M2, M7)', () => {
  it('a cell names its state and its value', () => {
    expect(cellLabel('Price', 2, 'suggested', '219.99')).toBe('Price on product 2: suggested, 219.99');
    expect(cellLabel('Price', 1, 'answered', ' 1.00 ')).toBe('Price on product 1: accepted, 1.00');
    expect(cellLabel('Rating', 1, 'empty', '')).toBe('Rating on product 1: empty');
    expect(cellLabel('Rating', 3, 'failed', '')).toBe('Rating on product 3: failed, empty');
  });
  it('a gap on an agreed row asks for its Accept, not the product', () => {
    const gate = verifyGate(board(), FIELDS, {});
    const agreed: RowStatus = { kind: 'agreed' };
    const needs: RowStatus = { kind: 'needs-you', reason: 'missing on product 1', product: 1 };
    expect(verifyReason(gate, FIELDS, [agreed, needs], 'x')).toBe('Accept Title first');
    expect(verifyReason(gate, FIELDS, [agreed, agreed], 'x')).toBe('Accept all agreed first');
    expect(verifyReason(gate, FIELDS, [needs, agreed], 'x')).toBe('Title still needs product 1');
    expect(verifyReason({ ok: true }, FIELDS, [agreed, agreed], 'Nothing has changed')).toBe('Nothing has changed');
    expect(verifyReason({ ok: false, reason: 'Say where SKU is on this website', field: 'sku' }, FIELDS, [agreed, agreed], 'x')).toBe('Say where SKU is on this website');
  });
});

const JLA = { source: 'json-ld', path: 'offers.availability' };
const JL3 = { source: 'json-ld', path: 'offers.offers[0].availability' };
const stock: Field = { key: 'in_stock', name: 'In stock', type: 'boolean', description: '', concept: 'availability' };
const sku: Field = { key: 'sku', name: 'SKU', type: 'text', description: '', concept: 'sku' };

describe('the table-first rules, revised', () => {
  it('names the odd product and accepts only the majority', () => {
    const b = board();
    const live = liveFor(b, 'in_stock', [sug('https://schema.org/InStock', [0], JLA), sug('https://schema.org/InStock', [0], JLA), sug('https://schema.org/InStock', [0], JL3)]);
    expect(rowStatus(stock, b, live, maps())).toEqual({ kind: 'majority', odd: [3], via: JLA });
    const next = acceptRow(b, stock, live, maps(), JLA);
    expect(next.answers.in_stock![U[0]!]).toMatchObject({ value: 'https://schema.org/InStock', via: JLA });
    expect(next.answers.in_stock![U[2]!]).toBeUndefined();
  });
  it('Accept all takes the majority part of such a row', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [1], JL), sug('219.99', [1], { source: 'meta', path: 'product:price:amount' }), sug('149.00', [1], JL)]);
    expect(rowStatus(price, b, live, maps())).toEqual({ kind: 'majority', odd: [2], via: JL });
    const r = acceptAllAgreed(b, [price], live, maps());
    expect(r.accepted).toEqual(['price']);
    expect(Object.keys(r.board.answers.price!)).toEqual([U[0], U[2]]);
  });
  it('a suggestion with no path is the odd one out of a majority', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [1], JL), sug('219.99', [1], JL), sug('149.00', [1])]);
    expect(rowStatus(price, b, live, maps())).toEqual({ kind: 'majority', odd: [3], via: JL });
  });
  it('a majority whose values match is same-everywhere that still keeps the odd product for a person', () => {
    const b = board();
    const live = liveFor(b, 'title', [sug('IKEA', [0], TL), sug('IKEA', [0], TL), sug('IKEA', [0], { source: 'meta', path: 'og:site_name' })]);
    const st = rowStatus(title, b, live, maps());
    expect(st).toEqual({ kind: 'same-everywhere', odd: [3], via: TL });
    expect(acceptAllAgreed(b, [title], live, maps()).accepted).toEqual([]);
    const next = acceptRow(b, title, live, maps(), st.kind === 'same-everywhere' ? st.via : undefined); // "Accept anyway"
    expect(Object.keys(next.answers.title!)).toEqual([U[0], U[1]]);
    expect(toBindingInput(next, [title]).paths).toEqual({ title: { [U[0]!]: TL, [U[1]!]: TL } });
  });
  it('yes/no fields are never "same on every product"', () => {
    const b = board();
    const live = liveFor(b, 'in_stock', [sug('https://schema.org/InStock', [0], JLA), sug('https://schema.org/InStock', [0], JLA), sug('https://schema.org/InStock', [0], JLA)]);
    expect(rowStatus(stock, b, live, maps()).kind).toBe('agreed');
  });
  it('a structured value shown in several places counts as one place, accepted without a mark', () => {
    const m = { ...maps(), [U[0]!]: boxesOf(['A1', 'A1']), [U[1]!]: boxesOf(['B2', 'B2', 'B2']), [U[2]!]: boxesOf(['C3']) };
    const b = board();
    const SK = { source: 'json-ld', path: 'sku' };
    const live = liveFor(b, 'sku', [sug('A1', [0, 1], SK), sug('B2', [0, 1, 2], SK), sug('C3', [0], SK)]);
    expect(rowStatus(sku, b, live, m).kind).toBe('agreed');
    expect(acceptRow(b, sku, live, m).answers.sku![U[0]!]).toEqual({ value: 'A1', mark: null, via: SK });
  });
  it('several places from the page search still need a person', () => {
    const m = { ...maps(), [U[0]!]: boxesOf(['A1', 'A1']) };
    const live = liveFor(board(), 'sku', [sug('A1', [0, 1], { source: 'xpath', path: '//x' }), sug('B2', [0], { source: 'xpath', path: '//x' }), sug('C3', [0], { source: 'xpath', path: '//x' })]);
    expect(rowStatus(sku, board(), live, m)).toMatchObject({ kind: 'needs-you', reason: 'found in 2 places on product 1' });
  });
  it('an answer keeps its path through a save and a reload', () => {
    const b = answer(board(), 'in_stock', U[0]!, { value: 'https://schema.org/InStock', mark: null, via: JLA });
    const input = toBindingInput(b, [stock]);
    expect(input.paths).toEqual({ in_stock: { [U[0]!]: JLA } });
    const back = boardFrom({ schemaDefinition: [stock], verificationSet: { urls: input.urls, expected: input.expected, paths: input.paths } });
    expect(back.answers.in_stock![U[0]!]!.via).toEqual(JLA);
    expect(toBindingInput(board(), [stock])).not.toHaveProperty('paths');
  });
  it('clicking the outlined element accepts its suggestion; any other element reads its own text', () => {
    const bx = boxesOf(['Available', 'Something']);
    const s = { captureId: 'c', value: 'https://schema.org/InStock', boxes: [0], origin: 'page-data' as const, via: JLA };
    expect(pickAnswer(bx, 0, stock, U[0]!, s)).toMatchObject({ value: 'https://schema.org/InStock', via: JLA });
    expect(pickAnswer(bx, 1, sku, U[0]!, undefined)).toMatchObject({ value: 'Something', mark: expect.anything() });
    const bad = { ...s, value: 'not a yes/no' };
    expect(pickAnswer(bx, 0, stock, U[0]!, bad)).toMatchObject({ value: 'Available' });
  });
  it('the badge names every failing product', () => {
    expect(failsText([])).toBe('');
    expect(failsText([1])).toBe('fails on product 1');
    expect(failsText([1, 3])).toBe('fails on products 1 and 3');
    expect(failsText([1, 2, 3])).toBe('fails on products 1, 2 and 3');
  });
  it('shows yes/no answers in one form', () => {
    expect(displayValue(stock, 'https://schema.org/InStock')).toBe('In stock');
    expect(displayValue(stock, 'Available')).toBe('In stock');
    expect(displayValue(stock, 'out of stock')).toBe('Out of stock');
    expect(displayValue({ ...stock, concept: 'remote' }, 'yes')).toBe('Yes');
    expect(displayValue(sku, 'A1')).toBe('A1');
  });
});

describe('the tab keeps page data over a carry', () => {
  it('a carried suggestion never replaces a page-data one', () => {
    const b = board();
    let s = mergeSuggestions({}, { in_stock: { value: 'https://schema.org/InStock', boxes: [0], via: JL } }, U[1]!, 'c1', 'page-data', b);
    s = mergeSuggestions(s, { in_stock: { value: '1', boxes: [0], via: { source: 'api', path: 'priority' } } }, U[1]!, 'c1', 'from-product', b);
    expect(s.in_stock![U[1]!]!.value).toBe('https://schema.org/InStock');
    s = mergeSuggestions(s, { in_stock: { value: 'x', boxes: [0], via: JL } }, U[2]!, 'c2', 'from-product', b);
    expect(s.in_stock![U[2]!]!.origin).toBe('from-product');
  });
  it('a majority row counts as agreed for the Verify reason', () => {
    const maj: RowStatus = { kind: 'majority', odd: [3], via: JL };
    const gate = { ok: false as const, reason: 'Title still needs product 1', gap: 'title' };
    expect(verifyReason(gate, FIELDS, [maj, { kind: 'needs-you', reason: 'x' }], undefined)).toBe('Accept Title first');
    expect(verifyReason(gate, FIELDS, [maj, { kind: 'agreed' }], undefined)).toBe('Accept all agreed first');
  });
});

describe('the one-click accept on a cell (final review I1)', () => {
  const inStock = (via: { source: string; path: string }) => sug('https://schema.org/InStock', [0], via);
  it('a majority row offers no one-click accept on its odd product', () => {
    const b = board();
    const live = liveFor(b, 'in_stock', [inStock(JLA), inStock(JLA), inStock(JL3)]);
    expect(cellAcceptable(stock, b, live, maps(), U[2]!)).toBe(false);
    expect(cellAcceptable(stock, b, live, maps(), U[0]!)).toBe(true);
  });
  it('once the majority is accepted, the odd product still has no one-click accept', () => {
    const b0 = board();
    const live0 = liveFor(b0, 'in_stock', [inStock(JLA), inStock(JLA), inStock(JL3)]);
    const b = acceptRow(b0, stock, live0, maps(), JLA);
    const live = liveFor(b, 'in_stock', [inStock(JLA), inStock(JLA), inStock(JL3)]);
    expect(rowStatus(stock, b, live, maps())).toMatchObject({ kind: 'needs-you', product: 3 });
    expect(cellAcceptable(stock, b, live, maps(), U[2]!)).toBe(false);
  });
  it('a same-everywhere row offers none on its odd product', () => {
    const b = board();
    const live = liveFor(b, 'title', [sug('IKEA', [0], TL), sug('IKEA', [0], TL), sug('IKEA', [0], { source: 'meta', path: 'og:site_name' })]);
    expect(cellAcceptable(title, b, live, maps(), U[2]!)).toBe(false);
  });
  it('an ordinary suggestion found in one place is one click', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [1], JL), null, null]);
    expect(cellAcceptable(price, b, live, maps(), U[0]!)).toBe(true);
  });
  it('never on an answered, invalid, several-place or not-yet-screenshotted cell', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [1], JL), sug('not a price', [1], JL), sug('149.00', [0, 1])]);
    expect(cellAcceptable(price, b, live, maps(), U[1]!)).toBe(false);
    expect(cellAcceptable(price, b, live, maps(), U[2]!)).toBe(false);
    expect(cellAcceptable(price, b, live, { [U[1]!]: maps()[U[1]!]! }, U[0]!)).toBe(false);
    const answered = answer(b, 'price', U[0]!, { value: '129.99', mark: null });
    expect(cellAcceptable(price, answered, live, maps(), U[0]!)).toBe(false);
  });
});

describe('what a carry sends (final review I4)', () => {
  it('sends the answer, its mark and the structured path it was accepted from', () => {
    expect(carryFrom({ value: '129.99', mark: MARK, via: JL })).toEqual({ value: '129.99', mark: MARK, via: JL });
    expect(carryFrom({ value: '129.99', mark: null })).toEqual({ value: '129.99' });
    expect(carryFrom({ value: '129.99', mark: null, via: { source: 'xpath', path: '//x' } })).toEqual({ value: '129.99' });
  });
});
