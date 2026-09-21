/**
 * Theme resolution, pure. The user's stored preference is `dark | light |
 * system`; `data-theme` on <html> is only ever `dark` or `light`.
 *
 * Server-side we cannot know the visitor's OS preference, so a `system` user
 * (and every signed-out visitor) is rendered `dark` — the product's default —
 * and THEME_BOOT_SCRIPT corrects `system` to `light` before first paint when
 * the OS asks for light. That keeps the flash out of the common case and makes
 * the light case a single attribute flip with no painted frame in between.
 */

export type Theme = 'dark' | 'light' | 'system';

export const THEMES_PREFS = ['dark', 'light', 'system'] as const;

/** The default when nothing is known: a signed-out visitor, or SSR for `system`. */
export const DEFAULT_RESOLVED: 'dark' | 'light' = 'dark';

export function resolveTheme(pref: Theme, systemPrefersDark: boolean): 'dark' | 'light' {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

/**
 * What the server renders on <html data-theme> for a given preference. `system`
 * resolves to the default here and is fixed on the client by THEME_BOOT_SCRIPT.
 */
export function serverTheme(pref: Theme | null | undefined): 'dark' | 'light' {
  if (!pref || pref === 'system') return DEFAULT_RESOLVED;
  return pref;
}

/**
 * Inlined in <head> for a `system` preference. Runs before first paint, so no
 * flash: it reads the media query and writes `data-theme` on <html>.
 */
export const THEME_BOOT_SCRIPT = [
  '(function(){try{',
  "var dark=window.matchMedia('(prefers-color-scheme: dark)').matches;",
  "document.documentElement.setAttribute('data-theme',dark?'dark':'light');",
  '}catch(e){}})()',
].join('');
