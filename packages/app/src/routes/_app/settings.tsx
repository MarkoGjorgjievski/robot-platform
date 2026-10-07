import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { keepPreviousData } from '@tanstack/react-query';
import { Page } from '../../components/page';
import { DeleteOrgDialog } from '../../components/org/delete-org-dialog';
import { GeneralPanel } from '../../components/org/general-panel';
import { MembersTable } from '../../components/org/members-table';
import { StaffActivityList } from '../../components/staff/staff-activity-list';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { deleteNote } from '../../lib/org-settings-view';
import { staffBlockedNote, type StaffEntryView } from '../../lib/staff-view';
import { trpc } from '../../lib/trpc';

const STAFF_ACTIVITY_PAGE_SIZE = 20;

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
});

/** The organisation's settings (spec §3, §5): general, members, danger zone. */
function SettingsPage() {
  const { session } = Route.useRouteContext();
  const org = session.currentOrg;
  const projects = trpc.projects.list.useQuery();
  const [deleting, setDeleting] = useState(false);
  // Staff mode (spec 2026-10-07 §2.3) wins over what the role allows.
  const staff = !!session.staff;
  const note = staffBlockedNote(staff, deleteNote({ role: org.role, personal: org.personal }));

  return (
    <Page title="Settings">
      <div className="space-y-4">
        <GeneralPanel key={org.id} name={org.name} role={org.role} staff={staff} />

        <MembersTable key={`m-${org.id}`} callerRole={org.role} callerUserId={session.user.id} staff={staff} />

        <StaffActivityPanel key={`a-${org.id}`} />

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
        projectCount={projects.isSuccess ? projects.data.length : null}
      />
    </Page>
  );
}

/**
 * "Robot staff activity" (spec 2026-10-07 §2.4): every member may read it,
 * no role check — it is the customer's own window into what staff did in
 * their organisation, not a privileged view.
 *
 * Fix round 1: `placeholderData: keepPreviousData` keeps the current page
 * on screen while the next one loads (paging used to flash the table away
 * on every click); a load failure gets its own line rather than reading as
 * "No staff activity yet." (`isPending` only covers the very first load —
 * `keepPreviousData` means a page change never re-enters it).
 */
function StaffActivityPanel() {
  const [page, setPage] = useState(0);
  const activity = trpc.orgs.staffActivity.useQuery({ page }, { placeholderData: keepPreviousData });
  const entries = (activity.data?.entries ?? []) as StaffEntryView[];

  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">Robot staff activity</h2>
      {activity.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5">
          <p role="alert" className="text-sm text-fail">
            Couldn't load staff activity.
          </p>
          <Button variant="outline" size="sm" onClick={() => void activity.refetch()} disabled={activity.isFetching}>
            {activity.isFetching ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      ) : activity.isPending ? (
        <div className="p-4">
          <Skeleton className="h-3.5 w-40 bg-raised" />
        </div>
      ) : (
        <StaffActivityList
          entries={entries}
          showCustomer={false}
          total={activity.data?.total ?? 0}
          page={page}
          pageSize={STAFF_ACTIVITY_PAGE_SIZE}
          onPage={setPage}
          empty="No staff activity yet."
        />
      )}
    </section>
  );
}
