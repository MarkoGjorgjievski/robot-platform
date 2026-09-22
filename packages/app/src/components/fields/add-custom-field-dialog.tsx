import { useState } from 'react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { FIELD_TYPES, TYPE_LABELS, addNote, nameRefusal, type FieldType } from '../../lib/fields-view';
import { trpc } from '../../lib/trpc';

/**
 * "Add your own": the way out of the catalogue, for the field no list could
 * have guessed. A name and a type, and nothing else — where the value sits on
 * a page is the website's business, asked for on the website's own screens.
 */
export function AddCustomFieldDialog({
  datasetId,
  websiteCount,
  open,
  onOpenChange,
}: {
  datasetId: string;
  websiteCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const add = trpc.datasets.addField.useMutation();
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const [error, setError] = useState<string | null>(null);

  /** Closing throws the draft away: a half-typed name in a reopened dialog reads as a bug. */
  function change(next: boolean) {
    if (!next) {
      setName('');
      setType('text');
      setError(null);
    }
    onOpenChange(next);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await add.mutateAsync({ datasetId, name: name.trim(), type });
      await Promise.all([
        utils.projects.get.invalidate(),
        utils.datasets.fieldStatus.invalidate({ datasetId }),
        // `projects.list` carries the project's field count.
        utils.projects.list.invalidate(),
      ]);
      change(false);
    } catch (err) {
      setError(nameRefusal(err, name.trim()) ?? 'That field could not be added. Try again.');
    }
  }

  const note = addNote(websiteCount);

  return (
    <Dialog open={open} onOpenChange={change}>
      {/* Cancel is the way out; the close cross would be a second one. */}
      <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add your own field</DialogTitle>
          <DialogDescription>For anything the catalogue does not already cover.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="field-name" className="text-sm font-normal text-muted-foreground">
              Name
            </Label>
            <Input
              id="field-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Warranty"
              autoFocus
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="field-type" className="text-sm font-normal text-muted-foreground">
              Type
            </Label>
            {/* Text is the default because it is the type that never loses
                anything: every value on a page is text until we know better. */}
            <Select value={type} onValueChange={(t) => setType(t as FieldType)}>
              <SelectTrigger id="field-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* The field belongs to the project, so it lands on every website in
              it. Said before the button, not discovered afterwards. */}
          {note ? <p className="text-sm text-muted-foreground">{note}.</p> : null}

          {error ? (
            <p role="alert" className="text-sm text-fail">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => change(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || add.isPending}>
              {add.isPending ? 'Adding…' : 'Add field'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
