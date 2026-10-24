import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { trpc } from '../../lib/trpc';
import { mutationErrorText, type MutationErrorLike } from '../../lib/mutation-error';
import { useStaffDetail } from '../../lib/use-staff-detail';
import {
  CHOICE_LABELS, DAY_NAMES, browserTimeZone, choiceOf, lastOutcomeLine, nextRunLine, scheduleFormProblem, scheduleFromForm, timeZoneOptions,
  type Schedule, type ScheduleChoice, type ScheduleLast,
} from '../../lib/site/recurring-view';
import { SettingsRow } from './settings-row';

/** Spec 2026-10-24 §3.6: how often the website runs on its own, when it next does, and what the last time did. */
export function ScheduleRow(props: {
  siteId: string; project: string; site: string;
  schedule: Schedule | null; nextRunAt: Date | null; scheduleLast: ScheduleLast | null;
}) {
  const utils = trpc.useUtils();
  const staff = useStaffDetail();
  const save = trpc.sources.update.useMutation();
  const fallbackZone = useMemo(() => browserTimeZone(), []);
  const [choice, setChoice] = useState<ScheduleChoice>(choiceOf(props.schedule));
  const [days, setDays] = useState<number[]>(props.schedule?.days ?? [1]);
  const [time, setTime] = useState(props.schedule?.time ?? '06:00');
  const [zone, setZone] = useState(props.schedule?.timeZone ?? fallbackZone);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timeZoneOptions(zone), [zone]);

  // The server is the authority: the row follows a fresh `sources.get` unless the customer is mid-edit.
  useEffect(() => {
    if (dirty) return;
    setChoice(choiceOf(props.schedule));
    setDays(props.schedule?.days ?? [1]);
    setTime(props.schedule?.time ?? '06:00');
    setZone(props.schedule?.timeZone ?? fallbackZone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.schedule, dirty]);

  // An edit clears a stale error: it was about the values the customer has just changed.
  const edit = (f: () => void) => { setDirty(true); setError(null); f(); };
  const problem = scheduleFormProblem(choice, days, time);
  async function onSave() {
    setError(null);
    try {
      await save.mutateAsync({ id: props.siteId, schedule: scheduleFromForm(choice, days, time, zone) });
    } catch (e) {
      setError(mutationErrorText(e as MutationErrorLike, staff));
      return;
    }
    // "Edited" until the fresh `sources.get` has landed, so the sync effect never shows the old schedule in between;
    // if the refetch fails the row keeps what was typed (and saved).
    try {
      await utils.sources.get.invalidate(undefined, undefined, { throwOnError: true });
      setDirty(false);
    } catch {
      // Saved; the page just could not reload it.
    }
  }
  const next = nextRunLine(props.nextRunAt, props.schedule?.timeZone ?? null);
  const last = lastOutcomeLine(props.scheduleLast, props.schedule?.timeZone ?? zone);

  return (
    <SettingsRow label="Schedule">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-base">
          <Select value={choice} onValueChange={(v) => edit(() => setChoice(v as ScheduleChoice))}>
            <SelectTrigger size="sm" aria-label="How often" className="w-[148px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CHOICE_LABELS) as ScheduleChoice[]).map((c) => (
                <SelectItem key={c} value={c}>{CHOICE_LABELS[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {choice !== 'off' ? (
            <>
              <Input type="time" step={60} aria-label="Time" value={time} onChange={(e) => edit(() => setTime(e.target.value))} className="h-8 w-[112px]" />
              <Select value={zone} onValueChange={(v) => edit(() => setZone(v as string))}>
                <SelectTrigger size="sm" aria-label="Time zone" className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          ) : null}
        </div>

        {choice === 'custom' ? (
          <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
            {DAY_NAMES.map((name, i) => {
              const iso = i + 1;
              const on = days.includes(iso);
              return (
                <Button key={name} type="button" size="sm" variant="outline" aria-pressed={on}
                  className={on ? 'border-text' : 'text-muted-foreground'}
                  onClick={() => edit(() => setDays(on ? days.filter((d) => d !== iso) : [...days, iso]))}>
                  {name}
                </Button>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => void onSave()} disabled={!dirty || !!problem || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save schedule'}
          </Button>
          {/* Every disabled control says why, within a line of it. */}
          {!dirty ? <span className="text-sm text-muted-foreground">No changes to save</span>
            : problem ? <span className="text-sm text-muted-foreground">{problem}</span> : null}
          {error ? <span role="alert" className="text-sm text-fail">{error}</span> : null}
        </div>

        {next ? <p className="text-sm text-muted-foreground">{next}</p> : null}
        {last ? (
          <p className="text-sm text-muted-foreground">
            {last.text}
            {last.runId ? (
              <>
                {' '}
                <Link to="/projects/$project/sites/$site/runs/$run" params={{ project: props.project, site: props.site, run: last.runId }}
                  className="text-link underline-offset-4 hover:underline">
                  Open the run
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </SettingsRow>
  );
}
