import { createFileRoute, redirect } from '@tanstack/react-router';
import { Page } from '../../../components/page';

/**
 * Ops overview — "which customer websites need us, and why?" (spec "Ops
 * design"). This is a placeholder: the real table (rows, segmented control,
 * search, reason chips) is the next task; this task only wires up operators
 * and the ops shell around it.
 *
 * Non-operators never see this screen: the server's FORBIDDEN on every
 * `ops.*` call is the real gate (future tasks' queries), and here the route
 * itself sends a non-operator back to /projects before it renders anything.
 */
export const Route = createFileRoute('/_app/ops/')({
  beforeLoad: ({ context }) => {
    if (!context.session.isOperator) throw redirect({ to: '/projects' });
  },
  component: OpsOverviewPage,
});

function OpsOverviewPage() {
  return (
    <Page title="All websites">
      <div className="rise rounded-[6px] border border-line bg-panel p-5 [box-shadow:var(--shadow)]">
        <p className="text-base text-muted-foreground">
          No customer websites yet. They appear here as soon as a customer adds one.
        </p>
      </div>
    </Page>
  );
}
