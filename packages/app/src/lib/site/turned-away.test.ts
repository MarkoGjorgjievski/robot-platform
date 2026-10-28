import { describe, expect, it } from 'vitest';
import type { ProofCapture } from './proof-capture-state';
import { barWords, captureKind, cardWords, giveUpSentence, isGivenUp, isWaiting, minutesSpent, mmss, nowActive, websiteName } from './turned-away';

const T0 = Date.parse('2026-10-28T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const base = { captureId: 'c', tiles: [], boxes: [], pageHeight: 0, capturedHeight: 0 };
const starting: ProofCapture = { ...base, captureId: '', status: 'starting' };
const capturing = (extra: Partial<ProofCapture> = {}): ProofCapture => ({ ...base, status: 'capturing', startedAt: iso(T0), ...extra });
const waiting = (extra: Partial<ProofCapture> = {}): ProofCapture => ({
  ...base, status: 'waiting', error: 'shop.example refused the browser (HTTP 403).', verdict: { kind: 'refused' },
  startedAt: iso(T0), firstStartedAt: iso(T0), retryAt: iso(T0 + 102_000), attempt: 2, of: 4, via: 'direct', ...extra,
});
const gaveUp = (extra: Partial<ProofCapture> = {}): ProofCapture => ({
  ...base, status: 'failed', error: 'shop.example refused the browser (HTTP 403).', verdict: { kind: 'refused' },
  gaveUp: true, attempts: 4, firstStartedAt: iso(T0), startedAt: iso(T0 + 14 * 60_000 + 10_000), ...extra,
});
const failed = (error: string, kind?: string): ProofCapture => ({ ...base, status: 'failed', error, ...(kind ? { verdict: { kind } } : {}) });
const captured: ProofCapture = { ...base, status: 'captured', tiles: ['/a.png'] };

const TAIL = "Swap this product for another, or try again later. We've told our team.";

describe('mmss', () => {
  it('reads minutes and seconds, seconds rounded up so 0:00 is only reached at the moment', () => {
    expect(mmss(102_000)).toBe('1:42');
    expect(mmss(12_000)).toBe('0:12');
    expect(mmss(12_001)).toBe('0:13');
    expect(mmss(999)).toBe('0:01');
    expect(mmss(8 * 60_000)).toBe('8:00');
    expect(mmss(75 * 60_000)).toBe('75:00');
  });
  it('never reads negative', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(-5_000)).toBe('0:00');
    expect(mmss(Number.NaN)).toBe('0:00');
  });
});

describe('minutesSpent', () => {
  it('rounds up, at least 1', () => {
    expect(minutesSpent(iso(T0), T0 + 14 * 60_000 + 1)).toBe(15);
    expect(minutesSpent(iso(T0), T0 + 15 * 60_000)).toBe(15);
    expect(minutesSpent(iso(T0), T0 + 5_000)).toBe(1);
    expect(minutesSpent(iso(T0), T0)).toBe(1);
    expect(minutesSpent(iso(T0), T0 - 60_000)).toBe(1);
  });
  it('takes an ISO string or a number for the end; null when the start is missing or unreadable', () => {
    expect(minutesSpent(iso(T0), iso(T0 + 120_000))).toBe(2);
    expect(minutesSpent(undefined, T0)).toBeNull();
    expect(minutesSpent('not a date', T0)).toBeNull();
    expect(minutesSpent(iso(T0), Number.NaN)).toBeNull();
  });
});

describe('websiteName', () => {
  it('the website\'s own name, or "This website" / "this website"', () => {
    expect(websiteName('Zara')).toEqual({ start: 'Zara', mid: 'Zara' });
    expect(websiteName('  Zara ')).toEqual({ start: 'Zara', mid: 'Zara' });
    expect(websiteName('')).toEqual({ start: 'This website', mid: 'this website' });
    expect(websiteName(null)).toEqual({ start: 'This website', mid: 'this website' });
  });
});

describe('giveUpSentence', () => {
  it('four tries', () => {
    expect(giveUpSentence(4, 15, 'Zara')).toBe(`We tried 4 times over 15 minutes and Zara kept turning us away. ${TAIL}`);
  });
  it('two or three tries (a 30-minute cap can give up early)', () => {
    expect(giveUpSentence(2, 31, 'Zara')).toBe(`We tried 2 times over 31 minutes and Zara kept turning us away. ${TAIL}`);
    expect(giveUpSentence(3, 1, 'Zara')).toBe(`We tried 3 times over 1 minute and Zara kept turning us away. ${TAIL}`);
  });
  it('one try', () => {
    expect(giveUpSentence(1, 30, 'Zara')).toBe(`We tried once and Zara kept turning us away for 30 minutes. ${TAIL}`);
    expect(giveUpSentence(1, 1, 'Zara')).toBe(`We tried once and Zara kept turning us away for 1 minute. ${TAIL}`);
  });
  it('no try made', () => {
    expect(giveUpSentence(0, 30, 'Zara')).toBe(`Zara kept turning us away for 30 minutes. ${TAIL}`);
    expect(giveUpSentence(undefined, 30, 'Zara')).toBe(`Zara kept turning us away for 30 minutes. ${TAIL}`);
  });
  it('no name: "This website" at the start, "this website" inside', () => {
    expect(giveUpSentence(4, 15, '')).toBe(`We tried 4 times over 15 minutes and this website kept turning us away. ${TAIL}`);
    expect(giveUpSentence(0, 2, '')).toBe(`This website kept turning us away for 2 minutes. ${TAIL}`);
  });
  it('no clock: the minutes are left out', () => {
    expect(giveUpSentence(4, null, 'Zara')).toBe(`We tried 4 times and Zara kept turning us away. ${TAIL}`);
    expect(giveUpSentence(2, null, 'Zara')).toBe(`We tried 2 times and Zara kept turning us away. ${TAIL}`);
    expect(giveUpSentence(1, null, 'Zara')).toBe(`We tried once and Zara turned us away. ${TAIL}`);
    expect(giveUpSentence(0, null, 'Zara')).toBe(`Zara kept turning us away. ${TAIL}`);
    expect(giveUpSentence(undefined, null, '')).toBe(`This website kept turning us away. ${TAIL}`);
    expect(giveUpSentence(1, null, '')).toBe(`We tried once and this website turned us away. ${TAIL}`);
  });
});

describe('isWaiting / isGivenUp / captureKind', () => {
  it('waiting, or a retry in progress, is waiting; try 1 capturing is not', () => {
    expect(isWaiting(waiting())).toBe(true);
    expect(isWaiting(capturing({ attempt: 2 }))).toBe(true);
    expect(isWaiting(capturing({ attempt: 1 }))).toBe(false);
    expect(isWaiting(capturing())).toBe(false);
    expect(isWaiting(undefined)).toBe(false);
  });
  it('given up only when the ladder ran out', () => {
    expect(isGivenUp(gaveUp())).toBe(true);
    expect(isGivenUp(failed('x', 'refused'))).toBe(false);
  });
  it('captureKind names the row words', () => {
    expect(captureKind(waiting())).toBe('waiting');
    expect(captureKind(capturing({ attempt: 3 }))).toBe('waiting');
    expect(captureKind(gaveUp())).toBe('turned-away');
    expect(captureKind(failed('x', 'refused'))).toBe('turned-away');
    expect(captureKind(failed('x', 'challenge'))).toBe('turned-away');
    expect(captureKind(failed('x', 'timeout'))).toBe('timeout');
    expect(captureKind(failed('x'))).toBeUndefined();
    expect(captureKind(capturing())).toBeUndefined();
    expect(captureKind(captured)).toBeUndefined();
    expect(captureKind(undefined)).toBeUndefined();
  });
});

describe('nowActive', () => {
  it('ticks only while a card is capturing, starting or waiting', () => {
    expect(nowActive([captured, failed('x'), undefined])).toBe(false);
    expect(nowActive([captured, waiting()])).toBe(true);
    expect(nowActive([capturing()])).toBe(true);
    expect(nowActive([starting])).toBe(true);
    expect(nowActive([gaveUp()])).toBe(false);
  });
});

describe('cardWords', () => {
  it('starting: a spinner and "Taking screenshot…" with no clock', () => {
    expect(cardWords(starting, 'Zara', T0)).toEqual({ tone: 'muted', icon: 'spinner', lines: ['Taking screenshot…'], actions: [] });
    expect(cardWords(undefined, 'Zara', T0)).toEqual({ tone: 'muted', icon: 'spinner', lines: ['Taking screenshot…'], actions: [] });
  });
  it('try 1 capturing counts up from startedAt', () => {
    expect(cardWords(capturing(), 'Zara', T0 + 12_400)).toEqual({ tone: 'muted', icon: 'spinner', lines: ['Taking screenshot… 12 s'], actions: [] });
    expect(cardWords(capturing({ attempt: 1, of: 4 }), 'Zara', T0 - 3_000).lines).toEqual(['Taking screenshot… 0 s']);
  });
  it('a direct retry in progress: "Trying again…", "Try 2 of 4", and Swap product', () => {
    expect(cardWords(capturing({ attempt: 2, of: 4, via: 'direct' }), 'Zara', T0 + 4_000))
      .toEqual({ tone: 'warn', icon: 'spinner', lines: ['Trying again… 4 s', 'Try 2 of 4'], actions: ['swap'] });
  });
  it('a retry another way in: "Trying another way in…"', () => {
    expect(cardWords(capturing({ attempt: 3, of: 4, via: 'fallback' }), 'Zara', T0 + 4_000).lines).toEqual(['Trying another way in… 4 s', 'Try 3 of 4']);
  });
  it('waiting: a clock, the name, a live countdown and the try', () => {
    expect(cardWords(waiting(), 'Zara', T0)).toEqual({ tone: 'warn', icon: 'clock', lines: ['Zara turned us away.', 'Trying again in 1:42', 'Try 2 of 4'], actions: ['swap'] });
    expect(cardWords(waiting(), 'Zara', T0 + 90_000).lines[1]).toBe('Trying again in 0:12');
  });
  it('waiting for a try another way in', () => {
    expect(cardWords(waiting({ attempt: 3, via: 'fallback', retryAt: iso(T0 + 12_000) }), 'Zara', T0).lines).toEqual(['Zara turned us away.', 'Trying another way in 0:12', 'Try 3 of 4']);
  });
  it('the countdown at 0 reads "Trying now…", never a negative time', () => {
    expect(cardWords(waiting(), 'Zara', T0 + 102_000).lines[1]).toBe('Trying now…');
    expect(cardWords(waiting(), 'Zara', T0 + 600_000).lines[1]).toBe('Trying now…');
    expect(cardWords(waiting({ retryAt: undefined }), 'Zara', T0).lines[1]).toBe('Trying now…');
  });
  it('waiting with no name: "This website turned us away."', () => {
    expect(cardWords(waiting(), '', T0).lines[0]).toBe('This website turned us away.');
  });
  it('given up: the whole sentence, Try again and Swap product', () => {
    expect(cardWords(gaveUp(), 'Zara', T0 + 20 * 60_000)).toEqual({
      tone: 'warn', icon: 'alert', lines: [`We tried 4 times over 15 minutes and Zara kept turning us away. ${TAIL}`], actions: ['retry', 'swap'],
    });
  });
  it("given up: the clock ends at the last try's start, however late the card is read", () => {
    expect(cardWords(gaveUp({ startedAt: iso(T0 + 2 * 60_000) }), 'Zara', T0 + 99 * 60_000).lines[0]).toContain('over 2 minutes');
    expect(cardWords(gaveUp(), 'Zara', T0 + 24 * 60 * 60_000).lines[0]).toContain('over 15 minutes');
  });
  it("given up with no last try's start: the minutes are left out, never counted to now", () => {
    expect(cardWords(gaveUp({ startedAt: undefined }), 'Zara', T0 + 3 * 60_000).lines[0]).toBe(`We tried 4 times and Zara kept turning us away. ${TAIL}`);
    expect(cardWords(gaveUp({ startedAt: undefined, attempts: 1 }), 'Zara', T0 + 60 * 60_000).lines[0]).toBe(`We tried once and Zara turned us away. ${TAIL}`);
    expect(cardWords(gaveUp({ startedAt: undefined, attempts: undefined }), 'Zara', T0).lines[0]).toBe(`Zara kept turning us away. ${TAIL}`);
    expect(cardWords(gaveUp({ firstStartedAt: undefined }), 'Zara', T0).lines[0]).toBe(`We tried 4 times and Zara kept turning us away. ${TAIL}`);
  });
  it('given up after one try or none (the 30-minute cap)', () => {
    expect(cardWords(gaveUp({ attempts: 1, startedAt: iso(T0 + 30 * 60_000) }), 'Zara', T0).lines[0]).toBe(`We tried once and Zara kept turning us away for 30 minutes. ${TAIL}`);
    expect(cardWords(gaveUp({ attempts: undefined, startedAt: iso(T0 + 30 * 60_000) }), 'Zara', T0).lines[0]).toBe(`Zara kept turning us away for 30 minutes. ${TAIL}`);
  });
  it('any other failure: its sentence and Try again, as today', () => {
    expect(cardWords(failed('This website took too long to answer. Try again.', 'timeout'), 'Zara', T0))
      .toEqual({ tone: 'warn', icon: 'alert', lines: ['This website took too long to answer. Try again.'], actions: ['retry'] });
    expect(cardWords({ ...failed(''), error: undefined }, 'Zara', T0).lines).toEqual(['The screenshot could not be taken']);
  });
  it('captured reads ready', () => {
    expect(cardWords(captured, 'Zara', T0)).toEqual({ tone: 'muted', icon: null, lines: ['ready'], actions: [] });
  });
  it('staff read the stored sentence, and the route when it is the fallback', () => {
    expect(cardWords(waiting({ via: 'fallback', attempt: 3 }), 'Zara', T0, { staff: true }).lines[0]).toBe('shop.example refused the browser (HTTP 403). (via fallback proxy)');
    expect(cardWords(waiting(), 'Zara', T0, { staff: true }).lines[0]).toBe('shop.example refused the browser (HTTP 403).');
    expect(cardWords(capturing({ attempt: 3, via: 'fallback' }), 'Zara', T0, { staff: true }).lines[0]).toBe('Trying another way in… 0 s (via fallback proxy)');
    expect(cardWords(gaveUp(), 'Zara', T0, { staff: true }).lines).toEqual([
      `We tried 4 times over 15 minutes and Zara kept turning us away. ${TAIL}`, 'shop.example refused the browser (HTTP 403).',
    ]);
  });
  it('no customer line says proxy, an address or an HTTP code', () => {
    const states = [starting, capturing(), capturing({ attempt: 2, via: 'fallback' }), waiting(), waiting({ via: 'fallback' }), gaveUp(), gaveUp({ attempts: 0 })];
    for (const s of states) for (const now of [T0, T0 + 102_000, T0 + 600_000]) {
      for (const line of cardWords(s, 'Zara', now).lines) expect(line).not.toMatch(/proxy|\bIP\b|HTTP|shop\.example|\d{3}\)/i);
    }
  });
});

describe('barWords', () => {
  const cards = (...c: Array<ProofCapture | undefined>) => c;
  it('nothing waiting or given up: no bar', () => {
    expect(barWords(cards(captured, capturing(), failed('x', 'timeout')), 'Zara', T0)).toBeNull();
    expect(barWords([], 'Zara', T0)).toBeNull();
  });
  it('one product waiting', () => {
    expect(barWords(cards(waiting(), captured, captured), 'Zara', T0))
      .toBe("Zara turned us away on product 1. We're trying again on our own, next in 1:42. You can keep working on products 2 and 3.");
  });
  it('two products waiting: the soonest try', () => {
    expect(barWords(cards(waiting(), waiting({ retryAt: iso(T0 + 30_000) }), captured), 'Zara', T0))
      .toBe("Zara turned us away on products 1 and 2. We're trying again on our own, next in 0:30. You can keep working on product 3.");
  });
  it('three products waiting: nothing left to keep working on', () => {
    expect(barWords(cards(waiting(), waiting(), capturing({ attempt: 2 })), 'Zara', T0))
      .toBe("Zara turned us away on products 1, 2 and 3. We're trying again on our own, next in 1:42.");
  });
  it('only a retry in progress, or every countdown at 0: trying now', () => {
    expect(barWords(cards(capturing({ attempt: 2 }), captured, captured), 'Zara', T0))
      .toBe("Zara turned us away on product 1. We're trying again on our own now. You can keep working on products 2 and 3.");
    expect(barWords(cards(waiting(), captured), 'Zara', T0 + 200_000))
      .toBe("Zara turned us away on product 1. We're trying again on our own now. You can keep working on product 2.");
  });
  it('given up', () => {
    expect(barWords(cards(gaveUp(), captured, captured), 'Zara', T0)).toBe('Zara kept turning us away on product 1. Swap it for another product, or try again later.');
    expect(barWords(cards(gaveUp(), gaveUp(), captured), 'Zara', T0)).toBe('Zara kept turning us away on products 1 and 2. Swap them for other products, or try again later.');
  });
  it('waiting and given up together: one line', () => {
    expect(barWords(cards(waiting(), gaveUp(), captured), 'Zara', T0))
      .toBe("Zara turned us away on product 1. We're trying again on our own, next in 1:42. Zara kept turning us away on product 2. Swap it for another product, or try again later. You can keep working on product 3.");
  });
  it('only the first three cards count; a blank card is nothing to work on', () => {
    expect(barWords(cards(captured, captured, captured, waiting()), 'Zara', T0)).toBeNull();
    expect(barWords(cards(waiting(), undefined, captured), 'Zara', T0))
      .toBe("Zara turned us away on product 1. We're trying again on our own, next in 1:42. You can keep working on product 3.");
  });
  it('no name: "This website"', () => {
    expect(barWords(cards(gaveUp()), '', T0)).toBe('This website kept turning us away on product 1. Swap it for another product, or try again later.');
  });
  it('"keep working on" names only products that are ready or on their first try, never another failure', () => {
    expect(barWords(cards(waiting(), failed('x', 'timeout'), captured), 'Zara', T0))
      .toBe("Zara turned us away on product 1. We're trying again on our own, next in 1:42. You can keep working on product 3.");
    expect(barWords(cards(waiting(), capturing(), starting), 'Zara', T0))
      .toBe("Zara turned us away on product 1. We're trying again on our own, next in 1:42. You can keep working on products 2 and 3.");
    expect(barWords(cards(waiting(), failed('x', 'timeout'), failed('y', 'refused')), 'Zara', T0))
      .toBe("Zara turned us away on product 1. We're trying again on our own, next in 1:42.");
  });
  it('a one-off refusal (no ladder) is not the bar\'s', () => {
    expect(barWords(cards(failed('x', 'refused')), 'Zara', T0)).toBeNull();
  });
});
