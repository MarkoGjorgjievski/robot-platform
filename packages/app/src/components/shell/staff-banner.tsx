import { useCallback, type ReactElement } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { trpc } from '../../lib/trpc';
import { bannerText } from '../../lib/staff-view';

/**
 * Leaves staff mode and lands in ops with a fresh session (spec 2026-10-07
 * §2.2). Works for an expired staff session too — the server logs the expiry.
 *
 * The refresh is the org switcher's `afterOrgChange`: reset the query cache
 * first (every cached answer belongs to the customer org just left), then
 * re-run the router's `beforeLoad` so `getSession` reads the own org again.
 */
export function useLeaveStaff() {
  const leaveOrg = trpc.ops.leaveOrg.useMutation();
  const { mutateAsync } = leaveOrg;
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const leave = useCallback(async () => {
    await mutateAsync();
    void queryClient.resetQueries();
    await router.invalidate();
    await navigate({ to: '/ops' });
  }, [mutateAsync, queryClient, router, navigate]);

  return { leave, pending: leaveOrg.isPending };
}

/**
 * Says why a control is disabled, on hover and on focus. A disabled button
 * fires no pointer events and takes no focus, so the tooltip hangs off a
 * wrapper that can be reached by both (the Fields table's locked type select
 * does the same). With no `note` the control is returned untouched.
 */
export function BlockedTooltip({ note, children }: { note: string | null; children: ReactElement }) {
  if (!note) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{note}</TooltipContent>
    </Tooltip>
  );
}

/** Full width above the top bar, a 2 px warn rail, no wash (spec 2026-10-07 §2.2). */
export function StaffBanner({ customer }: { customer: string }) {
  const { leave, pending } = useLeaveStaff();
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-l-2 border-line border-l-warn bg-bg px-5 py-2 text-sm md:px-8"
    >
      <span className="min-w-0 flex-1 truncate">{bannerText(customer)}</span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => leave().catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not leave staff mode.'))}
        disabled={pending}
      >
        Back to ops
      </Button>
    </div>
  );
}
