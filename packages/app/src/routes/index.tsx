import { createFileRoute, redirect } from '@tanstack/react-router';

// `/` is only ever a fork: the app proper starts at /projects.
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    throw redirect({ to: context.session ? '/projects' : '/login' });
  },
});
