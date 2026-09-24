import { useRouter } from '@tanstack/react-router';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { THEME_OPTIONS } from '../../lib/account-view';
import { applyThemeNow } from '../../lib/apply-theme';
import type { Theme } from '../../lib/theme';
import { trpc } from '../../lib/trpc';

/** Dark, light or system (spec §5). Saves on choice; the flip is immediate, as in the user menu. */
export function AppearancePanel({ theme }: { theme: Theme }) {
  const router = useRouter();
  const setTheme = trpc.auth.setTheme.useMutation({ onSuccess: () => router.invalidate() });

  function choose(next: Theme) {
    applyThemeNow(next);
    setTheme.mutate({ theme: next });
  }

  return (
    <section className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">Appearance</h2>
      <div className="px-4 py-3">
        <RadioGroup value={theme} onValueChange={(v) => choose(v as Theme)} aria-label="Theme" className="gap-2">
          {THEME_OPTIONS.map((o) => (
            <div key={o.value} className="flex items-center gap-2">
              <RadioGroupItem id={`theme-${o.value}`} value={o.value} />
              <Label htmlFor={`theme-${o.value}`} className="text-base font-normal">
                {o.label} <span className="text-muted-foreground">· {o.hint}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
        {setTheme.isError ? <p role="alert" className="mt-2 text-sm text-fail">The preference could not be saved; it applies until you reload.</p> : null}
      </div>
    </section>
  );
}
