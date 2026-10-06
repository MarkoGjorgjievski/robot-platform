import { useRef, useState } from 'react';
import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Page } from '../../../../components/page';
import { Button } from '../../../../components/ui/button';
import { RunDot } from '../../../../components/run-dot';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/ui/tooltip';
import { TYPE_LABELS, type FieldType } from '../../../../lib/fields-view';
import { runDotState } from '../../../../lib/run-dot-view';
import {
  backupsSummary,
  driftNoticeLines,
  fieldFlag,
  oneSourceWarning,
  pathKind,
  pathPercent,
  provenText,
  runStatsText,
  siteLastRunText,
  verifiedState,
  verifiedText,
  type OpsDriftResults,
  type OpsField,
  type OpsFieldPath,
} from '../../../../lib/ops-view';
import { trpc } from '../../../../lib/trpc';
import { useUnauthorizedRedirect } from '../../../../lib/use-unauthorized-redirect';

export type OpsWebsiteSearch = { from?: string };

/**
 * One website's approved paths, readable (plan "Ops design"). Non-operators
 * never see this screen: the server's FORBIDDEN on `ops.website` is the real
 * gate; here the route itself sends a non-operator back to /projects before
 * it renders anything.
 */
export const Route = createFileRoute('/_app/ops/websites/$sourceId')({
  validateSearch: (search: Record<string, unknown>): OpsWebsiteSearch => ({
    // Carries the overview's shareable state back through the breadcrumb's
    // first two crumbs (`_app.tsx`'s `OpsBreadcrumb`, `decodeOpsOverviewState`).
    from: typeof search.from === 'string' && search.from.length > 0 ? search.from : undefined,
  }),
  beforeLoad: ({ context }) => {
    if (!context.session.isOperator) throw redirect({ to: '/projects' });
  },
  component: OpsWebsitePage,
});

/** Narrowed to what this screen reads from `ops.website` — `results` stays
 * `unknown` here (the app never imports `@robot/scraper`'s verify types);
 * `driftNoticeLines` is handed the concrete shape it needs via a cast at the
 * one call site that reads it. */
type OpsWebsiteData = {
  sourceId: string;
  org: { id: string; name: string; slug: string };
  project: { name: string; slug: string };
  website: { name: string; slug: string; host: string };
  operatorIsMember: boolean;
  verified: { current: number; total: number };
  fields: OpsField[];
  drift: { status: string; results: unknown } | null;
  driftedFieldNames: string[];
  driftRunAt: string | null;
  lastRun: { status: string; at: string; rows: number | null } | null;
  proofUrls: string[];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `d MMM`, e.g. "5 Oct" — locale-free, like the rest of the app's dates (`lib/site/drift-view.ts`'s own `formatDMMM`, duplicated rather than imported: the app re-declares drift shapes file by file). */
function formatDMMM(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "a", "a and b", "a, b and c" — no Oxford comma (the stopped-extracting cell's field list). */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The collapsed row's summary and warn flag — one place both `FieldRow` and the default-expanded rule read from, so they can never disagree. */
function fieldRowInfo(field: OpsField, driftedFieldNames: readonly string[]) {
  const first = field.paths[0];
  const firstPathPct = first ? pathPercent(first.uses, first.hits) : null;
  const warn = oneSourceWarning(field.paths);
  // Field names are the contract's own identifiers (unique per project) —
  // `driftedFieldNames` carries names, not keys (Global Constraints), so
  // membership by name is the one way a field row knows it is the drifted one.
  const drifted = driftedFieldNames.includes(field.name);
  const flag = fieldFlag({ drifted, oneSource: !!warn, firstPathPct });
  return { firstPathPct, warn, drifted, flag };
}

function OpsWebsitePage() {
  const { sourceId } = Route.useParams();
  const query = trpc.ops.website.useQuery({ sourceId });
  const unauthorized = useUnauthorizedRedirect(query);
  // Per-field expand override; unset fields fall back to `fieldRowInfo`'s
  // default (a flagged field starts expanded, Global Constraints).
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  if (unauthorized) return null;

  const notFound = query.error?.data?.code === 'NOT_FOUND';
  if (notFound) {
    return (
      <Page title="Website">
        <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
          <p role="alert" className="text-base">
            This website isn't in ops.
          </p>
          <Button variant="outline" asChild>
            <Link to="/ops">All websites</Link>
          </Button>
        </div>
      </Page>
    );
  }

  if (query.isError) {
    return (
      <Page title="Website">
        <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
          <p role="alert" className="text-base text-fail">
            Couldn't load this website.
          </p>
          <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      </Page>
    );
  }

  const data = query.data as OpsWebsiteData | undefined;
  const loading = !data;

  function isExpanded(field: OpsField): boolean {
    return overrides[field.key] ?? !!fieldRowInfo(field, data?.driftedFieldNames ?? []).flag;
  }
  const allOpen = !!data && data.fields.length > 0 && data.fields.every(isExpanded);
  function toggleAll() {
    if (!data) return;
    const next = !allOpen;
    setOverrides((o) => ({ ...o, ...Object.fromEntries(data.fields.map((f) => [f.key, next])) }));
  }

  return (
    <Page
      title={loading ? <Skeleton as="span" className="inline-block h-6 w-40 align-middle" /> : data.website.name}
      subtitle={
        !loading ? (
          <a
            href={`https://${data.website.host}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono hover:text-text"
          >
            {data.website.host}
          </a>
        ) : undefined
      }
      actions={
        !loading ? (
          <>
            <Button variant="outline" asChild>
              <a href={`https://${data.website.host}`} target="_blank" rel="noopener noreferrer">
                Visit website
              </a>
            </Button>
            <OpenInAppLink data={data} />
          </>
        ) : undefined
      }
    >
      {loading ? (
        <LoadingSkeleton />
      ) : (
        <>
          <SummaryStrip data={data} />
          <DriftNotice data={data} />

          <section className="rise mb-4">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium">Approved paths</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Tried in order on every product page; the first that finds a value is used. Run counts cover
                  every run on {data.website.host}.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={toggleAll}>
                {allOpen ? 'Collapse all' : 'Expand all'}
              </Button>
            </div>
            <div className="rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
              {data.fields.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  proofUrls={data.proofUrls}
                  driftedFieldNames={data.driftedFieldNames}
                  expanded={isExpanded(field)}
                  onToggle={() => setOverrides((o) => ({ ...o, [field.key]: !isExpanded(field) }))}
                />
              ))}
            </div>
          </section>

          <section className="rise">
            <h2 className="text-lg font-medium">Proof pages</h2>
            <p className="mt-0.5 mb-2 text-sm text-muted-foreground">The products these paths were verified on.</p>
            <div className="rounded-[6px] border border-line bg-panel p-4 [box-shadow:var(--shadow)]">
              <ul className="space-y-1.5">
                {data.proofUrls.map((url, i) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sm text-link underline-offset-4 hover:underline"
                    >
                      Product {i + 1}: {url.replace(/^https?:\/\//, '')}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      )}
    </Page>
  );
}

/** "Open in the app" (Global Constraints): primary when the operator is also
 * a member, disabled with a focus-reachable tooltip otherwise ("Ops design"
 * Accessibility: "the disabled 'Open in the app' keeps its tooltip reachable
 * by focus"). A plain anchor, not a typed router `Link`: the target project
 * may belong to an org the operator's current session is not scoped to — a
 * full navigation lets `_app.tsx`'s own session/org gate decide what happens
 * next, rather than the router's client-side params alone. */
function OpenInAppLink({ data }: { data: OpsWebsiteData }) {
  const href = `/projects/${data.project.slug}/sites/${data.website.slug}`;
  const member = data.operatorIsMember;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild className={member ? undefined : 'pointer-events-none opacity-50'}>
          <a
            href={href}
            aria-disabled={member ? undefined : true}
            onClick={(e) => {
              if (!member) e.preventDefault();
            }}
          >
            Open in the app
          </a>
        </Button>
      </TooltipTrigger>
      {member ? null : <TooltipContent>You're not a member of {data.org.name}</TooltipContent>}
    </Tooltip>
  );
}

const VERIFIED_RAIL: Record<ReturnType<typeof verifiedState>, string> = {
  pass: 'border-pass',
  warn: 'border-warn',
  fail: 'border-fail',
};

/** The five-cell summary strip (plan "Ops design"), wrapping on narrow screens. */
function SummaryStrip({ data }: { data: OpsWebsiteData }) {
  const runState = data.lastRun ? runDotState({ status: data.lastRun.status }) : 'idle';
  const vState = verifiedState(data.verified.current, data.verified.total);

  const cell = (label: string, node: React.ReactNode) => (
    <div key={label} className="min-w-[150px]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-base">{node}</dd>
    </div>
  );

  return (
    <dl className="rise mb-4 flex flex-wrap gap-6 rounded-[6px] border border-line bg-panel p-4 [box-shadow:var(--shadow)]">
      {cell('Customer', data.org.name)}
      {cell('Project', data.project.name)}
      {cell(
        'Verified',
        <span className={`inline-block border-l-2 pl-2.5 ${VERIFIED_RAIL[vState]}`}>
          {verifiedText(data.verified.current, data.verified.total)}
        </span>,
      )}
      {cell(
        'Last run',
        <span className="inline-flex items-center gap-2">
          <RunDot status={runState} />
          {siteLastRunText(data.lastRun)}
        </span>,
      )}
      {cell(
        'Stopped extracting',
        data.driftedFieldNames.length > 0 ? (
          <span className="inline-block border-l-2 border-warn pl-2.5 text-warn">{joinAnd(data.driftedFieldNames)}</span>
        ) : (
          'None'
        ),
      )}
    </dl>
  );
}

/** The "What changed" notice (plan "Ops design"): shown only once the latest
 * drift check has results and the website still has drifted fields — a
 * re-verify clears `driftedFieldNames` without clearing old check rows, so
 * this must not outlive the thing it is about. */
function DriftNotice({ data }: { data: OpsWebsiteData }) {
  if (!data.drift || !data.drift.results || data.driftedFieldNames.length === 0) return null;

  const fieldNames = Object.fromEntries(data.fields.map((f) => [f.key, f.name]));
  const driftedKeys = data.fields.filter((f) => data.driftedFieldNames.includes(f.name)).map((f) => f.key);
  const lines = driftNoticeLines({
    driftedKeys,
    fieldNames,
    results: data.drift.results as OpsDriftResults,
    proofUrls: data.proofUrls,
  });
  if (lines.length === 0) return null;

  const when = data.driftRunAt ? formatDMMM(new Date(data.driftRunAt)) : null;

  return (
    <section aria-labelledby="ops-drift-heading" className="rise mb-4 rounded-[6px] border-l-2 border-warn bg-panel p-4 [box-shadow:var(--shadow)]">
      <h2 id="ops-drift-heading" className="text-base font-medium">
        What changed{when ? ` in the run of ${when}` : ''}
      </h2>
      <ul className="mt-2 space-y-1">
        {lines.map((line, i) => (
          <li key={i}>
            <b className="font-medium">{line.name}</b> <span className="text-sm text-muted-foreground">{line.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">Repairs are accepted on the website's Verification tab in the app.</p>
    </section>
  );
}

/** One contract field's disclosure row (plan "Ops design"): collapsed shows
 * the name/type, the first path's kind and backup count, the first path's
 * percentage, and a warn flag; expanded adds the try-order ladder. */
function FieldRow({
  field,
  proofUrls,
  driftedFieldNames,
  expanded,
  onToggle,
}: {
  field: OpsField;
  proofUrls: string[];
  driftedFieldNames: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const info = fieldRowInfo(field, driftedFieldNames);
  const typeLabel = TYPE_LABELS[field.type as FieldType] ?? field.type;
  const hasPaths = field.paths.length > 0;

  return (
    <div className="border-b border-line last:border-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`ops-field-${field.key}`}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left hover:bg-raised"
      >
        <ChevronRight
          aria-hidden
          className={`size-3 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{field.name}</span> <span className="text-sm text-muted-foreground">{typeLabel}</span>
        </span>
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {hasPaths ? backupsSummary(field.paths) : 'Not verified yet'}
        </span>
        <span className="text-sm whitespace-nowrap">
          {info.firstPathPct === null ? (
            <span className="text-muted-foreground">Not needed yet</span>
          ) : (
            <>
              <span className="text-muted-foreground">First path</span> {info.firstPathPct} %
            </>
          )}
        </span>
        <span className={`text-sm whitespace-nowrap ${info.flag ? 'text-warn' : ''}`}>{info.flag}</span>
      </button>

      {expanded ? (
        <div id={`ops-field-${field.key}`} className="px-4 pb-4">
          {hasPaths ? (
            <>
              <ol className="relative ml-[9px] space-y-3 border-l-2 border-line pl-6">
                {field.paths.map((p, i) => (
                  <LadderStep key={i} path={p} index={i} proofUrls={proofUrls} />
                ))}
              </ol>
              {info.warn ? <p className="mt-3 border-l-2 border-warn pl-3 text-sm text-warn">{info.warn}</p> : null}
            </>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">Not verified yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One numbered step of the try-order ladder. */
function LadderStep({ path, index, proofUrls }: { path: OpsFieldPath; index: number; proofUrls: string[] }) {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const pct = pathPercent(path.uses, path.hits);

  async function onCopy() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(path.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Refusal (no permission, no secure context): select the path text so
      // the operator can still copy it themselves (Global Constraints).
      const el = codeRef.current;
      if (!el) return;
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }

  return (
    <li className="group relative">
      <span
        aria-hidden
        className={`absolute top-0.5 -left-[31px] flex size-[18px] items-center justify-center rounded-full border text-[11px] ${
          index === 0 ? 'border-text bg-text text-bg' : 'border-line bg-bg text-muted-foreground'
        }`}
      >
        {index + 1}
      </span>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm text-muted-foreground">{pathKind(path.source)}</span>
        <span className="inline-flex min-w-0 items-center gap-2">
          <code ref={codeRef} title={path.path} className="max-w-[320px] truncate font-mono text-sm">
            {path.path}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`Copy path ${index + 1}`}
            onClick={onCopy}
            className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </span>
        <span className="text-sm text-muted-foreground">{provenText(path.provenOn, proofUrls)}</span>
      </div>

      <div className="mt-1">
        {path.uses === 0 ? (
          <span className="text-sm text-muted-foreground">Not needed yet</span>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">{runStatsText(path.uses, path.hits)}</span>
            <div className="mt-1 h-[2px] w-full max-w-[200px] bg-line">
              <div
                className={`h-full ${index === 0 && (pct ?? 100) < 90 ? 'bg-warn' : 'bg-text'}`}
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
          </>
        )}
      </div>
    </li>
  );
}

/** A skeleton strip, then three skeleton field rows (plan "Ops design"). */
function LoadingSkeleton() {
  return (
    <div className="rise space-y-4">
      <Skeleton className="h-20 w-full bg-raised" />
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-11 w-full bg-raised" />
        ))}
      </div>
    </div>
  );
}
