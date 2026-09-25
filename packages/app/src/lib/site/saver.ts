// The Verification tab's autosave: a quiet moment after the last change, one
// save in flight, the newest value wins. `flush` saves now (Verify calls it so
// the server has the record it is about to check).
export function createSaver<T>(opts: { delay: number; save: (value: T) => Promise<void>; onState?: (s: 'idle' | 'pending' | 'saving' | 'error') => void }) {
  let latest: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  const state = (s: 'idle' | 'pending' | 'saving' | 'error') => opts.onState?.(s);

  async function run(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (inFlight) { await inFlight.catch(() => {}); }
    if (!latest) return;
    const { value } = latest; latest = null;
    state('saving');
    inFlight = opts.save(value);
    try { await inFlight; state(latest ? 'pending' : 'idle'); }
    catch (e) { state('error'); throw e; }
    finally { inFlight = null; }
    if (latest) schedule();
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void run().catch(() => {}); }, opts.delay);
  }
  return {
    push(value: T) { latest = { value }; state('pending'); if (!inFlight) schedule(); },
    flush: run,
    dispose() { if (timer) clearTimeout(timer); timer = null; latest = null; },
  };
}
