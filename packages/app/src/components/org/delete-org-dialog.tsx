import { useState } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { deleteSummary, refusalMessage } from '../../lib/org-settings-view';
import { trpc } from '../../lib/trpc';

/**
 * The one irreversible thing on this page. The organisation's name has to be
 * typed back: a single confirm click is not enough for something that takes
 * every project with it. After it, the session stands on the caller's
 * personal organisation (orgs.delete moved it there), so the cache is thrown
 * away and the router re-reads the session — the same pattern as switching.
 */
export function DeleteOrgDialog({
  open,
  onOpenChange,
  orgName,
  projectCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
  projectCount: number;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = trpc.orgs.delete.useMutation();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === orgName;

  async function onConfirm() {
    setError(null);
    try {
      await remove.mutateAsync();
      onOpenChange(false);
      // Everything cached belongs to the organisation that no longer exists.
      queryClient.clear();
      await router.invalidate();
      await navigate({ to: '/projects' });
    } catch (e) {
      setError(refusalMessage(e, 'The organisation could not be deleted. Try again.'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setTyped(''); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {orgName}?</DialogTitle>
          <DialogDescription>{deleteSummary(projectCount)} This cannot be undone.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="confirm-org-name" className="text-sm text-muted-foreground">Type the organisation's name to confirm</Label>
          <Input id="confirm-org-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
        {error ? <p role="alert" className="text-sm text-fail">{error}</p> : null}
        <DialogFooter className="items-center">
          {!matches ? <span className="mr-auto text-sm text-muted-foreground">The name does not match yet</span> : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => void onConfirm()} disabled={!matches || remove.isPending}>
            {remove.isPending ? 'Deleting…' : 'Delete organisation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
