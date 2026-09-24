import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Page } from '../../components/page';
import { DeleteOrgDialog } from '../../components/org/delete-org-dialog';
import { GeneralPanel } from '../../components/org/general-panel';
import { MembersTable } from '../../components/org/members-table';
import { Button } from '../../components/ui/button';
import { deleteNote } from '../../lib/org-settings-view';
import { trpc } from '../../lib/trpc';

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
});

/** The organisation's settings (spec §3, §5): general, members, danger zone. */
function SettingsPage() {
  const { session } = Route.useRouteContext();
  const org = session.currentOrg;
  const projects = trpc.projects.list.useQuery();
  const [deleting, setDeleting] = useState(false);
  const note = deleteNote({ role: org.role, personal: org.personal });

  return (
    <Page title="Settings">
      <div className="space-y-4">
        <GeneralPanel key={org.id} name={org.name} role={org.role} />

        <MembersTable key={`m-${org.id}`} callerRole={org.role} callerUserId={session.user.id} />

        <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
          <h2 className="border-b border-line px-4 py-3 text-base font-medium">Danger zone</h2>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => setDeleting(true)} disabled={!!note} className="text-fail">
              Delete organisation
            </Button>
            {/* Every disabled control says why, within a line of it. */}
            <span className="text-sm text-muted-foreground">
              {note ?? 'Deletes every project in it. Members lose access.'}
            </span>
          </div>
        </section>
      </div>

      <DeleteOrgDialog
        open={deleting}
        onOpenChange={setDeleting}
        orgName={org.name}
        projectCount={projects.data?.length ?? 0}
      />
    </Page>
  );
}
