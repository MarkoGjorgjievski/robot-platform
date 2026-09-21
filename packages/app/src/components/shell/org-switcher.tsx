import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import type { Session, SessionOrg } from '../../lib/session';
import { trpc } from '../../lib/trpc';
import { AvatarSquare } from './avatar';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const ROLE_LABEL: Record<SessionOrg['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

export function OrgSwitcher({ session }: { session: Session }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const current = session.currentOrg;

  /**
   * Both mutations move the session's org on the server, so the router has to
   * re-run its `beforeLoad` — and every cached answer belongs to the org we
   * just left.
   *
   * `resetQueries`, and neither `invalidate` nor `removeQueries`:
   *
   * - invalidating marks a query stale but leaves its data in place, so the
   *   table goes on rendering the organisation we just left until the refetch
   *   lands.
   * - removing drops the row, which fixes the ⌘K palette (its query is
   *   `enabled` only while the palette is open, so it is inactive here) but
   *   leaves the *mounted* table's observer holding its last result with
   *   nothing to trigger a new fetch. Measured in the browser: after creating
   *   an organisation the breadcrumb said the new one while the table still
   *   listed the old one's project, indefinitely.
   * - resetting does both: back to pending, and active queries refetch.
   *
   * It runs *before* the router invalidation, which is the only way the stale
   * rows never reach the screen at all: `router.invalidate()` is a server
   * round-trip and anything left in the cache is painted throughout it. The
   * mutation has already committed the new org to the session row, so the
   * refetch this starts is answered for the new organisation.
   */
  async function afterOrgChange() {
    void queryClient.resetQueries();
    await router.invalidate();
  }

  const switchOrg = trpc.auth.switchOrg.useMutation({ onSuccess: afterOrgChange });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-base text-text hover:bg-raised"
          >
            <AvatarSquare initial={current.name} colour={session.user.avatarColour} />
            <span className="min-w-0 flex-1 truncate font-medium">{current.name}</span>
            {current.personal ? (
              <span className="shrink-0 rounded-[4px] border border-line px-1.5 py-px text-xs text-muted-foreground">
                Personal
              </span>
            ) : null}
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" sideOffset={6} className="w-[232px]">
          {session.orgs.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onSelect={() => {
                if (org.id !== current.id) switchOrg.mutate({ orgId: org.id });
              }}
              className="gap-2"
            >
              <AvatarSquare initial={org.name} colour={session.user.avatarColour} size={18} />
              <span className="min-w-0 flex-1 truncate text-base">{org.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{ROLE_LABEL[org.role]}</span>
              {org.id === current.id ? <Check className="size-3.5 shrink-0 text-text" /> : null}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => setCreating(true)} className="gap-2 text-base">
            <Plus className="size-3.5" />
            Create organisation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateOrgDialog open={creating} onOpenChange={setCreating} onCreated={afterOrgChange} />
    </>
  );
}

function CreateOrgDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = trpc.orgs.create.useMutation();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      // `orgs.create` makes the caller the owner and moves the session into the
      // new org, so there is nothing to switch to afterwards.
      await create.mutateAsync({ name: name.trim() });
      await onCreated();
      setName('');
      onOpenChange(false);
    } catch {
      setError('That organisation could not be created. Try again.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No close cross: this dialog has a Cancel, and two ways out of one
          small form is one too many. */}
      <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Create organisation</DialogTitle>
          <DialogDescription>
            You become its owner, and it becomes the organisation you are working in.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="org-name" className="text-sm font-normal text-muted-foreground">
              Name
            </Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Research"
              autoFocus
              required
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-fail">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'Creating…' : 'Create organisation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
