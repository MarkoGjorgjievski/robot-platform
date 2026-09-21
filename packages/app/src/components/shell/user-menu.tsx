import { useRouter, useNavigate } from '@tanstack/react-router';
import { MoreHorizontal, UserRound, LogOut } from 'lucide-react';
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
  const utils = trpc.useUtils();

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
    // The cookie is gone; drop every cached answer that was scoped to it before
    // the next screen can render with the last user's data.
    utils.invalidate();
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
          <DropdownMenuSubTrigger className="text-base">Theme</DropdownMenuSubTrigger>
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
