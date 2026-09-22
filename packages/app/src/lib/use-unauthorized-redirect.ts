import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';

/** The shape every tRPC query error has, narrowed to the one field this reads. */
type Refusable = { error?: { data?: { code?: string | null } | null } | null };

/**
 * A refused query is not a failure to report, it is a session that ended: send
 * them to sign in rather than leaving an error on a screen they are no longer
 * entitled to.
 *
 * `_app.tsx`'s `beforeLoad` gate only runs at navigation, so a session that
 * expires while the customer is sitting on a screen never reaches it — the
 * screen's own query is the first thing to hear about it. Every screen whose
 * data comes from a query calls this, so all of them agree on what an ended
 * session means; the boolean it returns is what the caller renders nothing on
 * while the navigation is in flight.
 */
export function useUnauthorizedRedirect(query: Refusable): boolean {
  const navigate = useNavigate();
  const unauthorized = query.error?.data?.code === 'UNAUTHORIZED';

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [unauthorized, navigate]);

  return unauthorized;
}
