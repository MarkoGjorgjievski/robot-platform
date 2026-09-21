import { useRouter, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, SunMoon, UserRound, LogOut } from 'lucide-react';
import type { Session } from '../../lib/session';
import { resolveTheme, type Theme } from '../../lib/theme';
import { trpc } from '../../lib/trpc';
import { AvatarSquare } from './avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

// No icons on these three: the radio indicator already says which one is on,
// and a dot plus a glyph plus a word is two marks too many for one line.
const THEME_ITEMS: Array<{ value: Theme; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

export function UserMenu({ session }: { session: Session }) {
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const setTheme = trpc.auth.setTheme.useMutation({ onSuccess: () => router.invalidate() });
  const signOut = trpc.auth.signOut.useMutation();

  function chooseTheme(theme: Theme) {
    // The attribute flips first: the preference is a round-trip to :4000 and a
    // theme switch that waits for the network reads as a broken click.
    const prefersDark =
      typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = resolveTheme(theme, prefersDark);
    setTheme.mutate({ theme });
  }

  async function onSignOut() {
    await signOut.mutateAsync();
    // `clear`, not `invalidate`. Invalidating marks the cached answers stale but
    // leaves them in the cache, and the QueryClient lives in `Providers` — one
    // per browser session, not one per user. Sign out, sign in as someone else
    // in the same tab, and the projects table would render the previous
    // account's rows from that cache until the refetch landed. Clearing throws
    // the data away, so there is nothing of theirs left to paint.
    queryClient.clear();
    await router.invalidate();
    await navigate({ to: '/login' });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-raised"
        >
          <AvatarSquare initial={session.user.name} colour={session.user.avatarColour} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base text-text">{session.user.name}</span>
            <span className="block truncate text-sm text-muted-foreground">{session.user.email}</span>
          </span>
          <MoreHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" sideOffset={6} className="w-[232px]">
        <DropdownMenuSub>
          {/* The icon is here so the three labels start on one line: Account and
              Sign out carry one, and a bare "Theme" sat 18 px to their left. */}
          <DropdownMenuSubTrigger className="text-base">
            <SunMoon className="size-3.5" />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-[148px]">
            <DropdownMenuRadioGroup
              value={session.user.theme}
              onValueChange={(value) => chooseTheme(value as Theme)}
            >
              {THEME_ITEMS.map(({ value, label }) => (
                <DropdownMenuRadioItem key={value} value={value} className="text-base">
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem className="gap-2 text-base" onSelect={() => navigate({ to: '/account' })}>
          <UserRound className="size-3.5" />
          Account
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem className="gap-2 text-base" onSelect={() => void onSignOut()}>
          <LogOut className="size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
