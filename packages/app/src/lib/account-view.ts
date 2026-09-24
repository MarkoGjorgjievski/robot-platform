import type { Theme } from './theme';

/** Why a name cannot be saved — the same bounds `auth.updateName` enforces, said before the click. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name';
  if (trimmed.length > 255) return 'Keep it under 255 characters';
  return null;
}

/** The appearance radio (spec §5 `/account`). Same order as the user menu's Theme submenu. */
export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; hint: string }> = [
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'system', label: 'System', hint: 'Follows your device' },
];
