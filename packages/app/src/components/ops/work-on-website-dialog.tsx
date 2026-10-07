import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { confirmCopy } from '../../lib/staff-view';
import { trpc } from '../../lib/trpc';

/**
 * "Work on {website} as staff?" (spec 2026-10-07 §2.1). Confirming moves the
 * operator's session into the customer's organisation server-side, then
 * refreshes the way the org switcher does (reset every cached answer, re-run
 * the router's session gate) and makes a full navigation to the website — so
 * `getSession` re-reads the session for the customer org on arrival.
 */
export function WorkOnWebsiteDialog({
  open,
  onOpenChange,
  sourceId,
  website,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceId: string;
  website: string;
  customer: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const enterOrg = trpc.ops.enterOrg.useMutation();
  // Stays true through the full navigation, not just the mutation, so the
  // button never flips back to "Start working" while the page unloads.
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = confirmCopy(website, customer);

  async function onConfirm() {
    setError(null);
    setStarting(true);
    try {
      const r = await enterOrg.mutateAsync({ sourceId });
      void queryClient.resetQueries();
      await router.invalidate();
      window.location.assign(r.path);
    } catch (e) {
      setStarting(false);
      const message = (e as { message?: string }).message;
      setError(message || 'Could not start working as staff. Try again.');
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
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
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
          <Button type="button" onClick={() => void onConfirm()} disabled={starting}>
            {starting ? 'Starting…' : 'Start working'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
