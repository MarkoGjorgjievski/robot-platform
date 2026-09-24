import { useState } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { trpc } from '../../lib/trpc';

export function RemoveMemberDialog({
  member,
  onOpenChange,
}: {
  /** The member to remove, or null when the dialog is closed. */
  member: { userId: string; name: string; email: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const remove = trpc.orgs.members.remove.useMutation();
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    if (!member) return;
    setError(null);
    try {
      await remove.mutateAsync({ userId: member.userId });
      await utils.orgs.members.list.invalidate();
      onOpenChange(false);
    } catch (e) {
      // The table already shows the reason before the click; a refusal here
      // is a race (a role changed between load and confirm), so the API's own
      // words are the right ones.
      const err = e as { message?: string };
      setError(err.message ?? 'That member could not be removed. Try again.');
    }
  }

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {member?.name}?</DialogTitle>
          <DialogDescription>
            {member?.email} loses access to this organisation and every project in it. They keep their own account.
          </DialogDescription>
        </DialogHeader>
        {error ? <p role="alert" className="text-sm text-fail">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => void onConfirm()} disabled={remove.isPending}>
            {remove.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
