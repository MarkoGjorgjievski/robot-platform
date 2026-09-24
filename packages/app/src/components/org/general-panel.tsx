import { useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { refusalMessage, renameNote, type Role } from '../../lib/org-settings-view';
import { trpc } from '../../lib/trpc';

/**
 * The organisation's name. A field and a Save, not an inline rename: the name
 * is in the sidebar's switcher and the breadcrumb, and a change here must be
 * a deliberate act with a button, the way the account's name is.
 */
export function GeneralPanel({ name, role }: { name: string; role: Role }) {
  const router = useRouter();
  const rename = trpc.orgs.rename.useMutation();
  const [draft, setDraft] = useState(name);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server is the authority: a name that changed elsewhere (another tab)
  // lands here unless this field is mid-edit.
  useEffect(() => {
    if (!dirty) setDraft(name);
  }, [name, dirty]);

  const note = renameNote(role);
  const trimmed = draft.trim();
  const unchanged = trimmed === name;
  const empty = trimmed === '';
  const reason = note ?? (empty ? 'Enter a name' : unchanged ? 'No changes to save' : null);

  async function save() {
    setError(null);
    try {
      await rename.mutateAsync({ name: trimmed });
      // The switcher and the breadcrumb read the session; re-run its loader.
      // `dirty` has to stay true across this await: `name` (the route
      // context's prop) is still the OLD name until this resolves, and the
      // effect above adopts `name` the moment `dirty` goes false — clearing
      // it before the invalidate would snap the input back to the old name
      // for the length of the round trip.
      await router.invalidate();
      setDirty(false);
    } catch (e) {
      setError(refusalMessage(e, 'The name could not be saved. Try again.'));
    }
  }

  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">General</h2>
      <div className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[140px_1fr] sm:items-center">
        <Label htmlFor="org-name" className="text-sm text-muted-foreground">Name</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="org-name"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
            disabled={!!note}
            maxLength={255}
            className="w-[280px] max-w-full"
          />
          <Button size="sm" variant="outline" onClick={() => void save()} disabled={!!reason || rename.isPending}>
            {rename.isPending ? 'Saving…' : 'Save name'}
          </Button>
          {/* Every disabled control says why, within a line of it. */}
          {reason ? <span className="text-sm text-muted-foreground">{reason}</span> : null}
          {error ? <span role="alert" className="text-sm text-fail">{error}</span> : null}
        </div>
      </div>
    </section>
  );
}
