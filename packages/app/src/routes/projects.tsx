import { createFileRoute, redirect } from '@tanstack/react-router';

// Placeholder: the shell's landing page. Task 6 fills it with the projects table.
export const Route = createFileRoute('/projects')({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: '/login' });
  },
  component: ProjectsPage,
});

function ProjectsPage() {
  return (
    <main className="px-6 py-6">
      <h1 className="rise text-2xl font-semibold tracking-tight">Projects</h1>
    </main>
  );
}
