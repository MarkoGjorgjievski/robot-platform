import { describe, it, expect } from 'vitest';
import { createBoardStore, seedDecision } from './board-store';
import { emptyBoard } from './verification-model';

const B1 = { ...emptyBoard(), listingUrl: 'https://s.example/c/1' };
const B2 = { ...emptyBoard(), listingUrl: 'https://s.example/c/2' };

describe('seedDecision (final review I3)', () => {
  it('seeds from the server when nothing was pushed here', () => {
    expect(seedDecision(undefined, 1000)).toEqual({ kind: 'server' });
  });
  it('waits while a save is in flight', () => {
    expect(seedDecision({ board: B1, pushedAt: 500, confirmed: false, pending: Promise.resolve() }, 1000)).toEqual({ kind: 'wait' });
  });
  it('seeds from the stored board and saves it again when its save never landed', () => {
    expect(seedDecision({ board: B1, pushedAt: 500, confirmed: false, pending: null }, 1000)).toEqual({ kind: 'stored', board: B1, resave: true });
  });
  it('seeds from the stored board when it was pushed after the cached copy was fetched', () => {
    expect(seedDecision({ board: B1, pushedAt: 2000, confirmed: true, pending: null }, 1000)).toEqual({ kind: 'stored', board: B1, resave: false });
  });
  it('seeds from the server when the cached copy is newer than the last saved board', () => {
    expect(seedDecision({ board: B1, pushedAt: 500, confirmed: true, pending: null }, 1000)).toEqual({ kind: 'server' });
  });
});

describe('the board store', () => {
  it('records the latest push, its save, and confirms only the board that was saved', async () => {
    const store = createBoardStore();
    store.pushed('s', B1, 10);
    let resolve!: () => void;
    const p = new Promise<void>((r) => { resolve = r; });
    store.saving('s', p);
    expect(store.get('s')).toMatchObject({ board: B1, pushedAt: 10, confirmed: false, pending: p });
    store.pushed('s', B2, 20); // a newer board arrives while B1 saves
    store.saved('s', B1); // B1 landing does not confirm B2
    expect(store.get('s')).toMatchObject({ board: B2, confirmed: false, pending: p });
    resolve();
    await p;
    await Promise.resolve();
    expect(store.get('s')!.pending).toBeNull();
    store.saved('s', B2);
    expect(store.get('s')!.confirmed).toBe(true);
  });
  it('a failed save clears pending and leaves the board unconfirmed', async () => {
    const store = createBoardStore();
    store.pushed('s', B1, 10);
    const p = Promise.reject(new Error('down'));
    store.saving('s', p);
    await p.catch(() => {});
    await Promise.resolve();
    expect(store.get('s')).toMatchObject({ pending: null, confirmed: false });
  });
});
