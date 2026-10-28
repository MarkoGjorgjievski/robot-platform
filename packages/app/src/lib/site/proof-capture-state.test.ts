import { describe, expect, it } from 'vitest';
import { capturePollMs, proofCaptureState, type ProofPoll } from './proof-capture-state';
import { SCREENSHOT_COULD_NOT_START, SCREENSHOT_TOO_LONG } from './verify-messages';

const landed: ProofPoll = { status: 'captured', tiles: ['/captures/a.png'], boxes: [], pageHeight: 900, capturedHeight: 900, title: 'Widget A' };
const failed = (error: string, verdict?: { kind: string }): ProofPoll => ({ status: 'failed', error, ...(verdict ? { verdict } : {}), tiles: [], boxes: [], pageHeight: 0, capturedHeight: 0 });

describe('proofCaptureState (spec 2026-10-20 §3.5.5)', () => {
  it('a failed start says the start sentence, never the error text', () => {
    expect(proofCaptureState({ startError: 'TRPCClientError: Failed to fetch', captureId: null })).toMatchObject({ status: 'failed', error: SCREENSHOT_COULD_NOT_START });
  });
  it('a stalled capture says it took too long', () => {
    expect(proofCaptureState({ captureId: 'c', poll: { data: failed('stalled'), isError: false } })).toMatchObject({ status: 'failed', error: SCREENSHOT_TOO_LONG });
  });
  it('staff read a verdict sentence as stored, with its kind', () => {
    expect(proofCaptureState({ captureId: 'c', poll: { data: failed('shop.example did not answer in time.', { kind: 'timeout' }), isError: false }, staff: true }))
      .toMatchObject({ status: 'failed', error: 'shop.example did not answer in time.', verdict: { kind: 'timeout' } });
  });
  it('a customer reads the verdict in customer words; the kind still passes through', () => {
    expect(proofCaptureState({ captureId: 'c', poll: { data: failed('shop.example did not answer in time.', { kind: 'timeout' }), isError: false } }))
      .toMatchObject({ status: 'failed', error: 'This website took too long to answer. Try again.', verdict: { kind: 'timeout' } });
  });
  it('a poll that errors before any answer stops "taking screenshot…" and says the start sentence', () => {
    expect(proofCaptureState({ captureId: 'c', poll: { isError: true } })).toMatchObject({ captureId: 'c', status: 'failed', error: SCREENSHOT_COULD_NOT_START });
  });
  it('a poll error after the capture landed keeps the capture', () => {
    expect(proofCaptureState({ captureId: 'c', poll: { data: landed, isError: true } })).toMatchObject({ status: 'captured', tiles: landed.tiles, title: 'Widget A' });
  });
  it('polls every 2 s while capturing, every 5 s while waiting, and not once settled (spec 2026-10-28 §3.6)', () => {
    expect(capturePollMs('capturing')).toBe(2000);
    expect(capturePollMs('waiting')).toBe(5000);
    expect(capturePollMs('captured')).toBe(false);
    expect(capturePollMs('failed')).toBe(false);
    expect(capturePollMs(undefined)).toBe(false);
  });
  describe('the ladder (spec 2026-10-28 §3.1, §3.6)', () => {
    const empty = { tiles: [], boxes: [], pageHeight: 0, capturedHeight: 0 };
    const waiting: ProofPoll = {
      status: 'waiting', error: 'shop.example refused the browser (HTTP 403).', verdict: { kind: 'refused' }, ...empty,
      startedAt: '2026-10-28T12:00:00.000Z', firstStartedAt: '2026-10-28T12:00:00.000Z', retryAt: '2026-10-28T12:02:00.000Z', attempt: 2, of: 4, via: 'fallback',
    };
    it('a waiting capture reads waiting, with its countdown, try and route', () => {
      expect(proofCaptureState({ captureId: 'c', poll: { data: waiting, isError: false } })).toMatchObject({
        captureId: 'c', status: 'waiting', verdict: { kind: 'refused' },
        startedAt: waiting.startedAt, firstStartedAt: waiting.firstStartedAt, retryAt: waiting.retryAt, attempt: 2, of: 4, via: 'fallback',
      });
    });
    it('a customer\'s waiting error is in customer words; staff read it as stored', () => {
      expect(proofCaptureState({ captureId: 'c', poll: { data: waiting, isError: false } }).error).not.toMatch(/HTTP|shop\.example/);
      expect(proofCaptureState({ captureId: 'c', poll: { data: waiting, isError: false }, staff: true }).error).toBe('shop.example refused the browser (HTTP 403).');
    });
    it('a capturing retry keeps its try and route', () => {
      const s = proofCaptureState({ captureId: 'c', poll: { data: { status: 'capturing', ...empty, startedAt: 'x', attempt: 3, of: 4, via: 'direct' }, isError: false } });
      expect(s).toMatchObject({ status: 'capturing', startedAt: 'x', attempt: 3, of: 4, via: 'direct' });
    });
    it('a given-up row keeps gaveUp, attempts, its first start and the poll\'s time', () => {
      const gaveUp: ProofPoll = { status: 'failed', error: 'shop.example refused the browser (HTTP 403).', verdict: { kind: 'refused' }, ...empty, gaveUp: true, attempts: 4, firstStartedAt: 'f' };
      expect(proofCaptureState({ captureId: 'c', poll: { data: gaveUp, isError: false, updatedAt: 123 } }))
        .toMatchObject({ status: 'failed', gaveUp: true, attempts: 4, firstStartedAt: 'f', polledAt: 123 });
    });
    it('a row written before the ladder carries none of its fields', () => {
      const s = proofCaptureState({ captureId: 'c', poll: { data: { status: 'capturing', ...empty }, isError: false } });
      for (const k of ['startedAt', 'retryAt', 'attempt', 'of', 'via', 'gaveUp', 'attempts', 'firstStartedAt', 'polledAt']) expect(s).not.toHaveProperty(k);
    });
  });
  it('no id yet, or no answer yet, is starting', () => {
    expect(proofCaptureState({ captureId: null })).toMatchObject({ status: 'starting' });
    expect(proofCaptureState({ captureId: 'c', poll: { isError: false } })).toMatchObject({ status: 'starting' });
  });
});
