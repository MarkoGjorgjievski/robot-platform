import { useState } from 'react';
import { AvatarSquare } from '../shell/avatar';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Skeleton } from '../ui/skeleton';
import { RemoveMemberDialog } from './remove-member-dialog';
import { roleLabel, roleNote, roleOptions, removeNote, type Role } from '../../lib/org-settings-view';
import { trpc } from '../../lib/trpc';

type Member = { userId: string; email: string; name: string; avatarColour: string; role: Role };

/**
 * Who is in the organisation and what they may do (spec §5 `/settings`:
 * list, role, remove). There is no "add" — invitations are outside this
 * design (spec §9) — so the table is the whole story of membership for now.
 */
export function MembersTable({ callerRole, callerUserId }: { callerRole: Role; callerUserId: string }) {
  const utils = trpc.useUtils();
  const members = trpc.orgs.members.list.useQuery();
  const setRole = trpc.orgs.members.setRole.useMutation();
  const [removing, setRemoving] = useState<Member | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(member: Member, role: Role) {
    setError(null);
    try {
      await setRole.mutateAsync({ userId: member.userId, role });
      await utils.orgs.members.list.invalidate();
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message ?? 'That role could not be saved. Try again.');
    }
  }

  // `memberships.role` is a `varchar`, not a pgEnum, so tRPC infers `string`
  // here rather than the three-value union the API actually only ever writes.
  const rows = (members.data ?? []) as Member[];
  const options = roleOptions(callerRole);

  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">Members</h2>
      <div className="overflow-x-auto md:overflow-x-visible">
        <table className="w-full min-w-[560px] border-collapse text-base md:min-w-0">
          <colgroup>
            <col />
            <col className="w-[200px]" />
            <col className="w-[104px]" />
          </colgroup>
          <thead>
            <tr className="[&>th]:border-b [&>th]:border-line [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground">
              <th className="px-4 text-left text-sm">Member</th>
              <th className="px-3 text-left text-sm">Role</th>
              <th className="px-4 text-right text-sm"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {members.isPending ? (
              <tr><td className="px-4 py-2.5" colSpan={3}><Skeleton className="h-3.5 w-40 bg-raised" /></td></tr>
            ) : null}
            {rows.map((m) => {
              const isSelf = m.userId === callerUserId;
              const rNote = roleNote({ caller: callerRole, target: m.role });
              const xNote = removeNote({ caller: callerRole, target: m.role, isSelf });
              return (
                <tr key={m.userId} className="border-b border-line transition-colors last:border-0 hover:bg-raised">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <AvatarSquare initial={m.name} colour={m.avatarColour} />
                      <span className="min-w-0">
                        <span className="block truncate">{m.name}{isSelf ? <span className="text-muted-foreground"> · you</span> : null}</span>
                        <span className="block truncate font-mono text-sm text-muted-foreground">{m.email}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {rNote ? (
                      <span className="flex flex-col">
                        <span>{roleLabel(m.role)}</span>
                        <span className="text-sm text-muted-foreground">{rNote}</span>
                      </span>
                    ) : (
                      <Select value={m.role} onValueChange={(v) => void changeRole(m, v as Role)} disabled={setRole.isPending}>
                        <SelectTrigger size="sm" aria-label={`Role of ${m.name}`} className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((r) => (
                            <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {xNote ? (
                      <span className="text-sm text-muted-foreground">{xNote}</span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setRemoving(m)}>Remove</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error ? <p role="alert" className="px-4 py-2 text-sm text-fail">{error}</p> : null}
      {members.isError ? <p role="alert" className="px-4 py-3 text-sm text-fail">The members could not be loaded. Try again.</p> : null}
      <RemoveMemberDialog member={removing} onOpenChange={(open) => { if (!open) setRemoving(null); }} />
    </section>
  );
}
