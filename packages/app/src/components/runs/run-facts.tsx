import type { RunFact } from '../../lib/site/run-screen-view';

/**
 * Started, Completed, Duration, Rows — the four facts of a run, in the grammar
 * the Extract tab's sample facts already use: a quiet label, and the value in
 * mono because it is the thing being read.
 *
 * A row of four, not a panel each: these are one reading, not four.
 */
export function RunFacts({ facts }: { facts: RunFact[] }) {
  return (
    <dl className="rise mb-3 grid grid-cols-2 gap-x-6 gap-y-3 rounded-[6px] border border-line bg-panel px-4 py-3 [box-shadow:var(--shadow)] md:grid-cols-4">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-sm text-muted-foreground">{fact.label}</dt>
          <dd className="mt-0.5 font-mono text-lg break-words">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
