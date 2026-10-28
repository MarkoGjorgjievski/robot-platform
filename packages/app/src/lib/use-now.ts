import { useSyncExternalStore } from 'react';

// One 1 s ticker per tab (spec 2026-10-28 §3.6): every card's "Taking screenshot… 12 s" and
// "Trying again in 1:42" counts from the same tick, and the timer runs only while some component
// asks for it — so the big Verification body never re-renders on the clock, only the small parts that
// show it.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let current = Date.now();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const idle = () => () => {};
const snapshot = () => current;

/**
 * The time now, in ms, ticking once a second while `active` (a card is counting up or down).
 * Idle, it reads the last tick and holds no timer of its own.
 */
export function useNow(active: boolean): number {
  return useSyncExternalStore(active ? subscribe : idle, snapshot, snapshot);
}
