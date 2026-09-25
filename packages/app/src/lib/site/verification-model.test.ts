import { describe, it, expect } from 'vitest';
import {
  answer, badge, boardFrom, canSave, pointable, MIN_BOX_SIDE, productsProblem, dropCard, emptyBoard, fieldsFor, liveSuggestions, mergeSuggestions, reverifyScope,
  segment, setCards, shortUrl, toBindingInput, validateValue, valueFromBox, verifyGate, type Board, type Box, type Field,
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
  it('lists fields that fit the element first, and marks the ones already answered here', () => {
    const b = answer(board(), 'title', U[0]!, { value: 'A', mark: MARK });
    const list = fieldsFor(box({ text: '$129.99' }), FIELDS, b, U[0]!);
    expect(list.map((l) => [l.field.key, l.fits, l.answered])).toEqual([['price', true, false], ['title', true, true]]);
    const img = fieldsFor(box({ kind: 'image', src: 'https://s.example/a.jpg' }), [...FIELDS, { key: 'img', name: 'Image', type: 'image', description: '' }], board(), U[0]!);
    expect(img[0]!.field.key).toBe('img');
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
    expect(badge({ key: 'price', results, unchangedKeys: ['title', 'price'], running: false, cards })).toEqual({ kind: 'fails', product: 2 });
    expect(badge({ key: 'title', results, unchangedKeys: [], running: false, cards })).toEqual({ kind: 'changed' });
    expect(badge({ key: 'title', results, unchangedKeys: [], running: true, cards })).toEqual({ kind: 'checking' });
    expect(badge({ key: 'title', results: null, unchangedKeys: [], running: false, cards })).toBeNull();
  });
  it('a field that failed and has not changed since reads fails on product n, not changed (it is never current)', () => {
    const results = { price: { certified: [], cells: { [U[0]!]: { status: 'pass' as const }, [U[1]!]: { status: 'fail' as const }, [U[2]!]: { status: 'pass' as const } } } };
    expect(badge({ key: 'price', results, unchangedKeys: ['price'], running: false, cards: board().cards })).toEqual({ kind: 'fails', product: 2 });
    expect(badge({ key: 'price', results, unchangedKeys: [], running: false, cards: board().cards })).toEqual({ kind: 'changed' });
  });
});

describe('the Verify gate', () => {
  it('names the first gap on products 1 to 3', () => {
    expect(verifyGate(board(), FIELDS, {})).toEqual({ ok: false, reason: 'Title still needs product 1' });
    expect(verifyGate(full(), FIELDS, {})).toEqual({ ok: true });
  });
  it('refuses a value of the wrong type', () => {
    const b = answer(full(), 'price', U[1]!, { value: 'free', mark: null });
    expect(verifyGate(b, FIELDS, {})).toEqual({ ok: false, reason: 'Price on product 2: Not a money amount' });
  });
  it('lets products 4 to 6 stay empty but not suggested, and not wholly empty', () => {
    let b = setCards(full(), [...full().cards, { url: 'https://s.example/p/4', title: 'W4' }]);
    expect(verifyGate(b, FIELDS, {})).toEqual({ ok: false, reason: 'Product 4 needs at least one field, or drop it' });
    b = answer(b, 'title', 'https://s.example/p/4', { value: 'W', mark: MARK });
    expect(verifyGate(b, FIELDS, {})).toEqual({ ok: true });
    const s = mergeSuggestions({}, { price: { value: '2.00', boxes: [0] } }, 'https://s.example/p/4', 'c', 'from-product', b);
    expect(verifyGate(b, FIELDS, s)).toEqual({ ok: false, reason: 'Price has a suggestion to confirm on product 4' });
  });
  it('needs three products', () => {
    expect(verifyGate({ ...full(), cards: full().cards.slice(0, 2) }, FIELDS, {})).toEqual({ ok: false, reason: 'Add at least three products' });
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
});
