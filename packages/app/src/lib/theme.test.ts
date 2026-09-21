import { describe, expect, it } from 'vitest';
import { DEFAULT_RESOLVED, THEME_BOOT_SCRIPT, resolveTheme, serverTheme } from './theme';

describe('resolveTheme', () => {
  it('follows the OS for `system`', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('ignores the OS for an explicit preference', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('serverTheme', () => {
  it('renders `system` and the signed-out visitor as the default', () => {
    expect(serverTheme('system')).toBe(DEFAULT_RESOLVED);
    expect(serverTheme(null)).toBe(DEFAULT_RESOLVED);
    expect(serverTheme(undefined)).toBe(DEFAULT_RESOLVED);
    expect(DEFAULT_RESOLVED).toBe('dark');
  });

  it('renders an explicit preference as itself', () => {
    expect(serverTheme('light')).toBe('light');
    expect(serverTheme('dark')).toBe('dark');
  });
});

describe('THEME_BOOT_SCRIPT', () => {
  it('reads the OS preference and writes data-theme', () => {
    expect(THEME_BOOT_SCRIPT).toContain('prefers-color-scheme');
    expect(THEME_BOOT_SCRIPT).toContain('data-theme');
  });

  it('is a single expression safe to inline in a <script> tag', () => {
    expect(THEME_BOOT_SCRIPT).not.toContain('</script');
    expect(() => new Function(THEME_BOOT_SCRIPT)).not.toThrow();
  });

  it('actually flips the attribute', () => {
    const el: Record<string, string> = {};
    const fn = new Function('window', 'document', THEME_BOOT_SCRIPT);
    fn(
      { matchMedia: (q: string) => ({ matches: q.includes('dark') ? false : true }) },
      { documentElement: { setAttribute: (k: string, v: string) => void (el[k] = v) } }
    );
    expect(el['data-theme']).toBe('light');
  });
});
