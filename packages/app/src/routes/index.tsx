import { createFileRoute, redirect } from '@tanstack/react-router';

// `/` is only ever a fork: the app proper starts at /projects, or at /ops for
// an operator (ops mode, 2026-10-06) — staff live in their own shell, not a
// customer's workspace.
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: '/login' });
    throw redirect({ to: context.session.isOperator ? '/ops' : '/projects' });
  },
});
