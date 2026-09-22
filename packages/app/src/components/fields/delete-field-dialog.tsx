import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { deleteNote, type FieldView } from '../../lib/fields-view';
import { trpc } from '../../lib/trpc';

/**
 * Deleting a field is the one irreversible thing on this screen, and it reaches
 * every website in the project — so the sentence under the title counts them,
 * and says how many had already proved the field, before the button is pressed.
 */
export function DeleteFieldDialog({
  datasetId,
  field,
  websiteCount,
  onOpenChange,
}: {
  datasetId: string;
  /** The field being deleted, or null when nothing is. */
  field: FieldView | null;
  websiteCount: number;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const remove = trpc.datasets.deleteField.useMutation();
  const [error, setError] = useState<string | null>(null);

  // The dialog animates out over 200 ms, by which time `field` is already null.
  // Holding the last one keeps the title and the count steady while it closes,
  // instead of blanking them on the way.
  const [shown, setShown] = useState(field);
  useEffect(() => {
    if (field) setShown(field);
  }, [field]);

  async function onConfirm() {
    if (!shown) return;
    setError(null);
    try {
      await remove.mutateAsync({ datasetId, key: shown.key });
      await Promise.all([
        utils.projects.get.invalidate(),
        utils.datasets.fieldStatus.invalidate({ datasetId }),
        // `projects.list` carries the project's field count.
        utils.projects.list.invalidate(),
        // The Output header is the contract's field names.
        utils.projects.output.invalidate(),
      ]);
      onOpenChange(false);
    } catch {
      setError('That field could not be deleted. Try again.');
    }
  }

  return (
    <Dialog
      open={!!field}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Delete {shown?.name}?</DialogTitle>
          <DialogDescription>{shown ? deleteNote(shown, websiteCount) : null}</DialogDescription>
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
            {remove.isPending ? 'Deleting…' : 'Delete field'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
