import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { deleteNote } from '../../lib/site-settings-view';
import { trpc } from '../../lib/trpc';

/**
 * Deleting a website is the one irreversible thing on this tab — its pages,
 * values and extractions go with it. `sources.delete` refuses a confirmed
 * website outright (`PRECONDITION_FAILED`); that refusal is shown here
 * verbatim, in the API's own words, rather than pre-empted client-side (the
 * ruling the old dashboard made) — `deleteNote` already says the same thing
 * before the click, but the button is not disabled for it, so a race between
 * load and confirm still gets the true reason.
 */
export function DeleteWebsiteDialog({
  open,
  onOpenChange,
  projectSlug,
  sourceId,
  name,
  confirmedAt,
  runCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  sourceId: string;
  name: string;
  confirmedAt: Date | null;
  runCount: number;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const remove = trpc.sources.delete.useMutation();
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setError(null);
    try {
      await remove.mutateAsync({ sourceId });
      // The project home's websites table and its row count both read
      // `projects.get`/`projects.list` — this website has to be gone from both
      // before the customer lands back there.
      await Promise.all([utils.projects.get.invalidate(), utils.projects.list.invalidate()]);
      onOpenChange(false);
      void navigate({ to: '/projects/$project', params: { project: projectSlug } });
    } catch (e) {
      const err = e as { data?: { code?: string }; message?: string };
      setError(
        err.data?.code === 'PRECONDITION_FAILED'
          ? (err.message ?? 'That website could not be deleted.')
          : 'That website could not be deleted. Try again.',
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>{deleteNote(confirmedAt, runCount)}</DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="text-sm text-fail">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={() => void onConfirm()} disabled={remove.isPending}>
            {remove.isPending ? 'Deleting…' : 'Delete website'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
