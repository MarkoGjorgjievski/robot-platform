import { useState } from 'react';
import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { signInErrorMessage } from '../lib/sign-in-error';
import { trpc } from '../lib/trpc';

export const Route = createFileRoute('/login')({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: '/projects' });
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const signIn = trpc.auth.signIn.useMutation();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await signIn.mutateAsync({ email, password });
      // The session lives in a cookie the root route reads on the server, so the
      // router has to re-run its beforeLoad before we move.
      await router.invalidate();
      await navigate({ to: '/projects' });
    } catch (err) {
      setError(signInErrorMessage(err));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      {/* 360 px, but never wider than the phone it is on. */}
      <div className="rise w-full max-w-[360px]">
        <p className="mb-5 font-mono text-sm text-faint">robot platform</p>

        <form
          onSubmit={onSubmit}
          className="rounded-[6px] border border-line bg-panel p-5 [box-shadow:var(--shadow)]"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="email" className="text-sm font-normal text-muted-foreground">
              Email
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="mt-4 grid gap-1.5">
            <Label htmlFor="password" className="text-sm font-normal text-muted-foreground">
              Password
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error ? (
            <p role="alert" className="mt-4 text-sm text-fail">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="mt-5 w-full" disabled={signIn.isPending}>
            {signIn.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
