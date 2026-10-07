import { useMemo } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Page } from '../../../components/page';
import { Button } from '../../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import { StaffActivityList } from '../../../components/staff/staff-activity-list';
import { dedupeStaffByEmail, type StaffEntryView } from '../../../lib/staff-view';
import { trpc } from '../../../lib/trpc';
import { useUnauthorizedRedirect } from '../../../lib/use-unauthorized-redirect';

/** Shareable state: the selected customer, the selected staff member, and the page. */
export type OpsActivitySearch = { org?: string; staff?: string; page?: number };

const PAGE_SIZE = 50;

/**
 * Every Robot staff action across every customer (spec 2026-10-07 §2.4).
 * Non-operators never see this screen: the server's FORBIDDEN on
 * `ops.staffActivity` is the real gate; here the route itself sends a
 * non-operator back to /projects before it renders anything (copies
 * `ops/index.tsx`'s own guard).
 */
export const Route = createFileRoute('/_app/ops/activity')({
  validateSearch: (search: Record<string, unknown>): OpsActivitySearch => ({
    org: typeof search.org === 'string' && search.org.length > 0 ? search.org : undefined,
    staff: typeof search.staff === 'string' && search.staff.length > 0 ? search.staff : undefined,
    page: typeof search.page === 'number' && Number.isInteger(search.page) && search.page > 0 ? search.page : undefined,
  }),
  beforeLoad: ({ context }) => {
    if (!context.session.isOperator) throw redirect({ to: '/projects' });
  },
  component: StaffActivityPage,
});

/**
 * `ops.staffActivity` has no way to filter on an email alone, only a
 * `userId` — so a `staff` search value of `email:{address}` (see
 * `staffOptionValue`) is treated as no staff filter rather than guessing.
 * The select itself renders that option disabled (below) so a person can't
 * normally land here this way; this is just the defensive fallback for a
 * hand-edited URL.
 */
function staffFilterUserId(staff: string | undefined): string | undefined {
  return staff && !staff.startsWith('email:') ? staff : undefined;
}

function staffOptionValue(s: { userId: string | null; email: string }): string {
  return s.userId ?? `email:${s.email}`;
}

/**
 * A `dedupeStaffByEmail` entry with no `userId` left (every account that
 * ever used this email is gone) can't be filtered on — `ops.staffActivity`
 * only accepts a `userId` — so the option is shown, for visibility, but
 * disabled rather than silently falling back to "All staff" on selection.
 * Its entries still show up under "All staff".
 */
function staffOptionLabel(s: { userId: string | null; email: string; name: string | null }): string {
  return s.userId ? s.name ?? s.email : `${s.email} (account deleted)`;
}

function StaffActivityPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const page = search.page ?? 0;

  const filters = trpc.ops.staffActivityFilters.useQuery();
  const staffOptions = useMemo(() => dedupeStaffByEmail(filters.data?.staff ?? []), [filters.data]);

  const activity = trpc.ops.staffActivity.useQuery({
    orgId: search.org,
    userId: staffFilterUserId(search.staff),
    page,
    pageSize: PAGE_SIZE,
  });
  const unauthorized = useUnauthorizedRedirect(activity);

  function patchSearch(patch: Partial<OpsActivitySearch>) {
    void navigate({
      to: '/ops/activity',
      search: (prev) => {
        const out: OpsActivitySearch = { ...prev, ...patch };
        for (const key of Object.keys(out) as (keyof OpsActivitySearch)[]) {
          if (out[key] === undefined) delete out[key];
        }
        return out;
      },
      replace: true,
    });
  }

  if (unauthorized) return null;

  const entries = (activity.data?.entries ?? []) as StaffEntryView[];
  const total = activity.data?.total ?? 0;
  const loading = activity.isPending;

  return (
    <Page title="Staff activity" subtitle="Everything Robot staff changed inside a customer's organisation.">
      <div className="rise mb-3 flex flex-wrap items-center gap-2">
        <Select value={search.org ?? '__all__'} onValueChange={(v) => patchSearch({ org: v === '__all__' ? undefined : v, page: undefined })}>
          <SelectTrigger aria-label="Customer" className="min-w-[160px]">
            <SelectValue placeholder="All customers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All customers</SelectItem>
            {(filters.data?.customers ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={search.staff ?? '__all__'} onValueChange={(v) => patchSearch({ staff: v === '__all__' ? undefined : v, page: undefined })}>
          <SelectTrigger aria-label="Staff member" className="min-w-[160px]">
            <SelectValue placeholder="All staff" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All staff</SelectItem>
            {staffOptions.map((s) => (
              <SelectItem key={staffOptionValue(s)} value={staffOptionValue(s)} disabled={!s.userId}>
                {staffOptionLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activity.isError ? (
        <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
          <p role="alert" className="text-base text-fail">
            Couldn't load staff activity.
          </p>
          <Button variant="outline" onClick={() => void activity.refetch()} disabled={activity.isFetching}>
            {activity.isFetching ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      ) : loading ? (
        <div className="rise rounded-[6px] border border-line bg-panel p-4 [box-shadow:var(--shadow)]">
          <Skeleton className="h-3.5 w-40 bg-raised" />
        </div>
      ) : (
        <div className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
          <StaffActivityList
            entries={entries}
            showCustomer
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPage={(p) => patchSearch({ page: p === 0 ? undefined : p })}
            empty="No staff activity yet."
          />
        </div>
      )}
    </Page>
  );
}
