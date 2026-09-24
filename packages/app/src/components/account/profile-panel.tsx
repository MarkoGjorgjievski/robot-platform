import { useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { nameProblem } from '../../lib/account-view';
import { refusalMessage } from '../../lib/org-settings-view';
import { trpc } from '../../lib/trpc';

/** Name and email (spec §5 `/account`). The email is read-only for now — sign-in is a stub (spec §9). */
export function ProfilePanel({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const update = trpc.auth.updateName.useMutation();
  const [draft, setDraft] = useState(name);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server is the authority: a name that changed elsewhere (another tab)
  // lands here unless this field is mid-edit.
  useEffect(() => {
    if (!dirty) setDraft(name);
  }, [name, dirty]);

  const trimmed = draft.trim();
  const unchanged = trimmed === name;
  const reason = nameProblem(draft) ?? (unchanged ? 'No changes to save' : null);

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({ name: trimmed });
      // The sidebar's user menu reads the session; re-run its loader. `dirty`
      // has to stay true across this await — see general-panel.tsx's save().
      await router.invalidate();
      setDirty(false);
    } catch (e) {
      setError(refusalMessage(e, 'The name could not be saved. Try again.'));
    }
  }

  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">Profile</h2>
      <dl>
        <div className="grid gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:grid-cols-[140px_1fr] sm:items-center">
          <dt><Label htmlFor="account-name" className="text-sm text-muted-foreground">Name</Label></dt>
          <dd className="flex flex-wrap items-center gap-2">
            <Input
              id="account-name"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(true);
              }}
              maxLength={256}
              className="w-[280px] max-w-full"
            />
            <Button size="sm" variant="outline" onClick={() => void save()} disabled={!!reason || update.isPending}>
              {update.isPending ? 'Saving…' : 'Save name'}
            </Button>
            {reason ? <span className="text-sm text-muted-foreground">{reason}</span> : null}
            {error ? <span role="alert" className="text-sm text-fail">{error}</span> : null}
          </dd>
        </div>
        <div className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[140px_1fr] sm:items-center">
          <dt className="text-sm text-muted-foreground">Email</dt>
          <dd className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-base">{email}</span>
            <span className="text-sm text-muted-foreground">Email cannot be changed yet</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
