// The Verification tab's autosave: a quiet moment after the last change, one
// save in flight, the newest value wins. `flush` saves now (Verify calls it so
// the server has the record it is about to check).
//
// Fix round 1: a failed save must not lose the value that failed to reach the
// server. On failure the value is restored to `latest` (unless something
// newer has since been pushed, which supersedes it) and — the chosen fix,
// over waiting for the next push/flush — a retry is scheduled automatically,
// the same way a value pushed mid-save schedules its own follow-up save.
// `flush()` always resolves or rejects with the outcome of the save that
// covers everything pushed before it was called (an already-in-flight save,
// one it dispatches itself, or a retry after a failure); two concurrent
// `flush()` calls both await the same underlying save rather than one
// resolving early.
export function createSaver<T>(opts: { delay: number; save: (value: T) => Promise<void>; onState?: (s: 'idle' | 'pending' | 'saving' | 'error') => void }) {
  let latest: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null; // the raw, currently-running save() call
  const state = (s: 'idle' | 'pending' | 'saving' | 'error') => opts.onState?.(s);

  function attempt(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    const { value } = latest!;
    latest = null;
    state('saving');
    const p = opts.save(value);
    inFlight = p;
    return p.then(
      () => {
        inFlight = null;
        state(latest ? 'pending' : 'idle');
        if (latest) schedule();
      },
      (e: unknown) => {
        inFlight = null;
        if (!latest) latest = { value }; // nothing newer arrived: keep this value for a retry
        state('error');
        if (latest) schedule(); // retry it (or the newer value that superseded it)
        throw e;
      },
    );
  }
  function schedule() {
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
    dispose() { if (timer) clearTimeout(timer); timer = null; latest = null; },
  };
}
