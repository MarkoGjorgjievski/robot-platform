import { useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Page } from '../../components/page';
import { MonthStepper } from '../../components/usage/month-stepper';
import { UsageTable } from '../../components/usage/usage-table';
import { UsageTotal } from '../../components/usage/usage-total';
import { monthKey, shiftMonth, usageView } from '../../lib/usage-view';
import { trpc } from '../../lib/trpc';
import { useUnauthorizedRedirect } from '../../lib/use-unauthorized-redirect';

export const Route = createFileRoute('/_app/usage')({
  component: UsagePage,
});

function UsagePage() {
  const current = monthKey(new Date());
  const [month, setMonth] = useState(current);
  const usage = trpc.usage.byProject.useQuery({ month });
  const rows = usageView(usage.data?.projects ?? []);
  const unauthorized = useUnauthorizedRedirect(usage);

  const empty = !usage.isPending && !usage.isError && rows.length === 0;

  return (
    <Page
      title="Usage"
      actions={<MonthStepper month={month} isCurrent={month === current} onChange={(d) => setMonth((m) => shiftMonth(m, d))} />}
    >
      <div className="space-y-4">
        <UsageTotal
          spendUsd={usage.data?.total.spendUsd ?? 0}
          pagesCaptured={usage.data?.total.pagesCaptured ?? 0}
          loading={usage.isPending}
        />

        {empty ? (
          <div className="rise rounded-[6px] border border-line bg-panel px-4 py-10 text-center [box-shadow:var(--shadow)]">
            <p className="text-base text-muted-foreground">
              No projects yet —{' '}
              <Link to="/projects" className="text-text underline-offset-4 hover:underline">
                create one
              </Link>{' '}
              and its spend will show here.
            </p>
          </div>
        ) : (
          <UsageTable rows={rows} loading={usage.isPending} />
        )}

        {usage.isError && !unauthorized ? (
          <p role="alert" className="rise text-base text-fail">
            Usage could not be loaded. Try again.
          </p>
        ) : null}
      </div>
    </Page>
  );
}
