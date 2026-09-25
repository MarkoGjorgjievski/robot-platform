// The Verification tab's autosave: a quiet moment after the last change, one
// save in flight, the newest value wins. `flush` saves now (Verify calls it so
// the server has the record it is about to check).
//
// Fix round 1: a failed save must not lose the value that failed to reach the
// server. On failure the value is restored to `latest` (unless something
// newer has since been pushed, which supersedes it). `flush()` always
// resolves or rejects with the outcome of the save that covers everything
// pushed before it was called (an already-in-flight save, one it dispatches
// itself, or a later retry); two concurrent `flush()` calls both await the
// same underlying save rather than one resolving early.
//
// Fix round 2: a failure does NOT schedule its own retry — an earlier version
// did, which against a down server saved every `delay` ms forever with no
// user action, flickering the state between 'saving' and 'error'. The
// restored (or superseding) value just sits in `latest`; the next `push()`
// (which already schedules whenever nothing is in flight) or `flush()`
// (which already dispatches whatever is pending) is what retries it — no
// extra code needed for either to pick it up. `dispose()` sets a `disposed`
// flag: once set, `onState` is never called again, and a save that was
// already in flight when `dispose()` ran — should it go on to fail — neither
// restores its value nor schedules anything (an unmounted saver must not come
// back to life). `opts.save` is invoked through a microtask
// (`Promise.resolve().then(...)`) so a *synchronous* throw from it becomes an
// ordinary rejection instead of escaping the timer callback and leaving
// `state` stuck on `'saving'`.
export function createSaver<T>(opts: { delay: number; save: (value: T) => Promise<void>; onState?: (s: 'idle' | 'pending' | 'saving' | 'error') => void }) {
  let latest: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null; // the raw, currently-running save() call
  let disposed = false;
  const state = (s: 'idle' | 'pending' | 'saving' | 'error') => { if (!disposed) opts.onState?.(s); };

  function attempt(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    const { value } = latest!;
    latest = null;
    state('saving');
    const p = Promise.resolve().then(() => opts.save(value)); // a synchronous throw becomes a rejection
    inFlight = p;
    return p.then(
      () => {
        inFlight = null;
        state(latest ? 'pending' : 'idle');
        if (!disposed && latest) schedule();
      },
      (e: unknown) => {
        inFlight = null;
        if (!disposed && !latest) latest = { value }; // nothing newer arrived: keep this value for the next push/flush to retry
        state('error');
        // No `schedule()` here: a failure must not retry itself, or a down
        // server gets hammered every `delay` ms with no user action.
        throw e;
      },
    );
  }
  function schedule() {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void attempt().catch(() => {}); }, opts.delay);
  }
  async function flush(): Promise<void> {
    for (;;) {
      if (inFlight) await inFlight;
      else if (latest) await attempt();
      else return;
    }
  }
  return {
    push(value: T) { latest = { value }; state('pending'); if (!inFlight) schedule(); },
    flush,
    dispose() { disposed = true; if (timer) clearTimeout(timer); timer = null; latest = null; },
  };
}
