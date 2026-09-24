import { resolveTheme, type Theme } from './theme';

/**
 * Flip the document's theme now, before the preference has round-tripped to
 * :4000 — a theme switch that waits for the network reads as a broken click.
 * Shared by the user menu and the Account page so both do exactly this.
 */
export function applyThemeNow(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = resolveTheme(theme, prefersDark);
}
