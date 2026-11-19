import type { ReactNode } from 'react';
import { runBar, type RunCounts } from '../../lib/site/run-progress';
import { overallFill, thinnestFields, type FieldFill } from '../../lib/site/run-overview-view';
import type { RunFact } from '../../lib/site/run-screen-view';

/**
 * The run page's overview (Marko 2026-11-18): three small cards above the rows — how far the run got, how full
 * its columns are, and when it ran. A figure, a bar and a legend each; the sentences they replace said the same
 * thing slower. State colours only (spec §4): green is extracted or filled, red is failed, the rest is quiet.
 */
export function OverviewCard({ title, aside, children, foot }: { title: string; aside?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3">
        <h3 className="text-sm text-muted-foreground">{title}</h3>
        {aside ? <span className="text-sm text-muted-foreground">{aside}</span> : null}
      </div>
      <div className="flex-1 px-4 pt-1.5 pb-3">{children}</div>
      {foot ? <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">{foot}</div> : null}
    </section>
  );
}

const PART_CLASS = { done: 'bg-pass', failed: 'bg-fail', running: 'bg-text', pending: 'bg-line' } as const;

/** "16 / 203", the outcome bar and its legend. `foot` is the run's buttons; `note` a line under the legend. */
export function ProductsCard({ counts, label, note, foot, title = 'Products' }: { counts: RunCounts; label: string; note?: ReactNode; foot?: ReactNode; title?: string }) {
  const bar = runBar(counts);
  return (
    <OverviewCard title={title} aside={label} foot={foot}>
      <p className="font-mono text-2xl leading-tight tabular-nums">
        {counts.done.toLocaleString('en-US')}
        <span className="text-base text-muted-foreground"> / {counts.detail.toLocaleString('en-US')}</span>
      </p>
      <div className="mt-2.5 flex h-1.5 gap-0.5" role="img" aria-label={bar.map((p) => p.label).join(', ')} data-testid="run-bar">
        {bar.map((p) => (
          <span key={p.key} title={p.label} style={{ width: `${p.percent}%` }} className={`min-w-[3px] rounded-full ${PART_CLASS[p.key]}`} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
        {bar.map((p) => (
          <li key={p.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`size-1.5 rounded-full ${PART_CLASS[p.key]}`} />
            {p.label}
          </li>
        ))}
      </ul>
      {note}
    </OverviewCard>
  );
}

/** The share of values present, and a bar for each of the emptiest fields. */
export function FieldsCard({ fill }: { fill: readonly FieldFill[] }) {
  const overall = overallFill(fill);
  const thin = thinnestFields(fill);
  const more = fill.filter((f) => f.total > 0 && f.filled < f.total).length - thin.length;
  return (
    <OverviewCard title="Values filled" aside={fill[0] ? `${fill.length} fields · ${fill[0].total.toLocaleString('en-US')} rows` : undefined}>
      {overall === null ? (
        <p className="pt-1 text-base text-muted-foreground">No rows yet.</p>
      ) : (
        <>
          <p className="font-mono text-2xl leading-tight tabular-nums">
            {overall}
            <span className="text-base text-muted-foreground">%</span>
          </p>
          {thin.length === 0 ? (
            <p className="mt-2.5 text-sm text-muted-foreground">Every field has a value in every row.</p>
          ) : (
            <ul className="mt-2.5 space-y-1.5" data-testid="field-fill">
              {thin.map((f) => (
                <li key={f.key} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-2.5 text-sm">
                  <span className="truncate" title={f.name}>{f.name}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`${f.filled} of ${f.total} rows have ${f.name}`}>
                    <span className={`block h-full rounded-full ${f.filled === 0 ? '' : 'bg-pass'}`} style={{ width: `${f.percent}%` }} />
                  </span>
                  <span className="font-mono text-muted-foreground tabular-nums">{f.filled}/{f.total}</span>
                </li>
              ))}
            </ul>
          )}
          {more > 0 ? <p className="mt-1.5 text-sm text-muted-foreground">and {more} more with empty values</p> : null}
        </>
      )}
    </OverviewCard>
  );
}

/** Started, completed, duration and the rest of the run's facts, as a quiet two-column list. */
export function TimingCard({ facts }: { facts: readonly RunFact[] }) {
  return (
    <OverviewCard title="Run">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 pt-1 text-base">
        {facts.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="min-w-0 truncate text-right font-mono" title={f.value}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </OverviewCard>
  );
}

export type RunTab = { key: string; label: string; count?: number | null; tone?: 'warn' };

/** The main card's strip: Rows, Pages, Repair — each with its count, the way a list of runs would carry its states. */
export function RunTabs({ tabs, value, onChange, aside }: { tabs: readonly RunTab[]; value: string; onChange: (key: string) => void; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 border-b border-line px-2">
      <div role="tablist" aria-label="What to show for this run" className="flex">
        {tabs.map((t) => {
          const on = t.key === value;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.key)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-base transition-colors ${on ? 'border-text text-text' : 'border-transparent text-muted-foreground hover:text-text'}`}
            >
              {t.label}
              {t.count != null ? (
                <span className={`rounded-full border px-1.5 font-mono text-xs tabular-nums ${t.tone === 'warn' && t.count > 0 ? 'border-warn/50 text-warn' : 'border-line text-muted-foreground'}`}>
                  {t.count.toLocaleString('en-US')}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {aside ? <div className="px-2 py-1.5 text-sm text-muted-foreground">{aside}</div> : null}
    </div>
  );
}
