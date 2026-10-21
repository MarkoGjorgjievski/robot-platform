import { describe, expect, it } from 'vitest';
import { proofCaptureState, type ProofPoll } from './proof-capture-state';
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
  it('no id yet, or no answer yet, is starting', () => {
    expect(proofCaptureState({ captureId: null })).toMatchObject({ status: 'starting' });
    expect(proofCaptureState({ captureId: 'c', poll: { isError: false } })).toMatchObject({ status: 'starting' });
  });
});
