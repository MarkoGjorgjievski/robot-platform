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
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { siteNameFromUrl } from '../../lib/site-name';
import { trpc } from '../../lib/trpc';

/**
 * "Add website": an address and a name, nothing else. Everything the extractor
 * needs beyond that is decided on the website's own screens later — asking for
 * it here would turn the first step of the flow into a form.
 *
 * The address comes first because it is the thing the customer has in hand; the
 * name is derived from it and only typed when the guess is wrong.
 */
export function AddWebsiteDialog({
  projectSlug,
  open,
  onOpenChange,
}: {
  projectSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  // Until the customer types in the name field it belongs to the address: every
  // edit of the URL re-derives it. One keystroke in Name ends that for good —
  // overwriting a name someone has chosen is the rudest thing a form can do.
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = trpc.sources.createInProject.useMutation();

  function onUrlChange(next: string) {
    setUrl(next);
    if (!nameTouched) setName(siteNameFromUrl(next.trim()));
  }

  /** Closing throws the draft away: a half-typed address left in a reopened dialog reads as a bug. */
  function change(next: boolean) {
    if (!next) {
      setUrl('');
      setName('');
      setNameTouched(false);
      setError(null);
    }
    onOpenChange(next);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await create.mutateAsync({ projectSlug, name: name.trim(), url: url.trim() });
      await utils.projects.get.invalidate({ projectSlug });
      await utils.projects.list.invalidate();
      // The Output screen's summary line counts the project's websites.
      await utils.projects.output.invalidate({ projectSlug });
      change(false);
      // Land on the new website's Verification tab — there is nothing else to
      // configure first; the address and name above are all Add website asks for.
      await navigate({ to: '/projects/$project/sites/$site', params: { project: projectSlug, site: created.sourceSlug } });
    } catch {
      setError('That website could not be added. Try again.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      {/* Cancel is the way out; the close cross would be a second one. */}
      <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add website</DialogTitle>
          <DialogDescription>We collect the project's fields from this website.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="website-url" className="text-sm font-normal text-muted-foreground">
              Address
            </Label>
            <Input
              id="website-url"
              type="url"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://www.example.com/products/…"
              autoFocus
              required
            />
            <p className="text-sm text-muted-foreground">Any page on the website will do.</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="website-name" className="text-sm font-normal text-muted-foreground">
              Name
            </Label>
            <Input
              id="website-name"
              value={name}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
              placeholder="Example"
              required
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-fail">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => change(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!url.trim() || !name.trim() || create.isPending}>
              {create.isPending ? 'Adding…' : 'Add website'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
