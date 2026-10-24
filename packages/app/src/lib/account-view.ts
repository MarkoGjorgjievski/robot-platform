import type { Theme } from './theme';

/** Why a name cannot be saved — the same bounds `auth.updateName` enforces, said before the click. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name';
  if (trimmed.length > 255) return 'Keep it to 255 characters or fewer';
  return null;
}

/** The appearance radio (spec §5 `/account`). Same order as the user menu's Theme submenu. */
export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; hint: string }> = [
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'system', label: 'System', hint: 'Follows your device' },
];

/** The Email panel (spec 2026-10-24 email §3.4): which notification emails this person gets. */
export type EmailPrefs = { attention: boolean; failedRuns: boolean };

export const EMAIL_PREF_OPTIONS: ReadonlyArray<{ key: keyof EmailPrefs; label: string }> = [
  { key: 'attention', label: 'When a website needs attention' },
  { key: 'failedRuns', label: 'When a run fails' },
];
export const ACCOUNT_MESSAGES_LINE = 'Account messages are always sent.';
export const EMAIL_PREF_SAVE_FAILED = 'The preference could not be saved. Try again.';
export const EMAIL_PREF_LOAD_FAILED = 'Your email choices could not be loaded. Reload the page.';

/** Each switch as saved; until the preferences have loaded, shown on and held still. */
export function emailPrefRows(prefs: EmailPrefs | undefined): Array<{ key: keyof EmailPrefs; label: string; checked: boolean; disabled: boolean }> {
  return EMAIL_PREF_OPTIONS.map((o) => ({ ...o, checked: prefs ? prefs[o.key] : true, disabled: !prefs }));
}
