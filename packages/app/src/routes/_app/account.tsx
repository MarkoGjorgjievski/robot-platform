import { createFileRoute } from '@tanstack/react-router';
import { Page } from '../../components/page';
import { AppearancePanel } from '../../components/account/appearance-panel';
import { ProfilePanel } from '../../components/account/profile-panel';

export const Route = createFileRoute('/_app/account')({
  component: AccountPage,
});

/** The signed-in person's own settings (spec §3, §5): who they are, how the app looks to them. */
function AccountPage() {
  const { session } = Route.useRouteContext();
  return (
    <Page title="Account">
      <div className="space-y-4">
        <ProfilePanel name={session.user.name} email={session.user.email} />
        <AppearancePanel theme={session.user.theme} />
      </div>
    </Page>
  );
}
