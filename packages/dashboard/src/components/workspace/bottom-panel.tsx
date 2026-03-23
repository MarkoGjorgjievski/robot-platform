"use client";

import { useState } from "react";
import { CheckCircle2Icon, XCircleIcon, LoaderIcon, ClockIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { InputsPanel } from "./inputs-panel";

interface Run {
  id: string;
  status: string;
  inputLabel?: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface InputEntry {
  id: string;
  label: string;
  inputData: unknown;
  createdAt: Date;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

interface BottomPanelProps {
  runs: Run[];
  inputs: InputEntry[];
  sourceId?: string;
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  onSaveInput: (sourceId: string, label: string, inputData: Record<string, unknown>) => Promise<unknown>;
  onUpdateInput: (id: string, label: string, inputData: Record<string, unknown>) => Promise<unknown>;
  onDeleteInput: (id: string) => Promise<unknown>;
  onRunInput: (sourceId: string, inputLabel: string) => Promise<unknown>;
  runLogs?: string | null;
  runResults?: unknown;
  runError?: string | null;
}

type CenterTab = "output" | "data" | "config";

export function BottomPanel({
  runs,
  inputs,
  sourceId,
  selectedRunId,
  onSelectRun,
  onSaveInput,
  onUpdateInput,
  onDeleteInput,
  onRunInput,
  runLogs,
  runResults,
  runError,
}: BottomPanelProps) {
  const [centerTab, setCenterTab] = useState<CenterTab>("output");

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: Runs ──────────────────────────────── */}
      <div
        className="flex w-[240px] shrink-0 flex-col overflow-hidden"
        style={{ borderRight: '1px solid var(--ws-border)' }}
      >
        <div className="ws-group-header" style={{ cursor: 'default' }}>
          Runs
          <span className="ml-auto text-[0.55rem] opacity-60">{runs.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {runs.length === 0 ? (
            <div className="flex h-full items-center justify-center px-3">
              <span className="text-[0.65rem]" style={{ color: 'var(--ws-text-dim)' }}>No runs yet</span>
            </div>
          ) : (
            runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => onSelectRun(run.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 transition-colors hover:bg-[var(--ws-surface-hover)]"
                style={{
                  borderBottom: '1px solid var(--ws-border-subtle)',
                  background: run.id === selectedRunId ? 'var(--ws-accent-surface)' : 'transparent',
                  borderLeft: run.id === selectedRunId ? '2px solid var(--ws-accent)' : '2px solid transparent',
                }}
              >
                <RunStatusIcon status={run.status} />
                <span className="min-w-0 flex-1 truncate text-left text-[0.65rem]" style={{ color: 'var(--ws-text-muted)' }}>
                  {run.inputLabel ?? run.id.slice(0, 8)}
                </span>
                <span className="shrink-0 text-[0.55rem] tabular-nums" style={{ color: 'var(--ws-text-dim)' }}>
                  {run.startedAt ? formatRelativeTime(run.startedAt) : "\u2014"}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Center: Output / Data tabs ──────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="flex" style={{ borderBottom: '1px solid var(--ws-border)' }}>
          <button
            className="ws-tab"
            data-state={centerTab === "output" ? "active" : "inactive"}
            onClick={() => setCenterTab("output")}
          >
            Output
          </button>
          <button
            className="ws-tab"
            data-state={centerTab === "data" ? "active" : "inactive"}
            onClick={() => setCenterTab("data")}
          >
            Data
          </button>
          <button
            className="ws-tab"
            data-state={centerTab === "config" ? "active" : "inactive"}
            onClick={() => setCenterTab("config")}
          >
            Config
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto p-3">
          {centerTab === "output" && (
            <div className="h-full">
              {!selectedRunId ? (
                <pre className="h-full text-[0.65rem] leading-relaxed" style={{ color: 'var(--ws-text-dim)' }}>
                  Select an input and run to see output.
                </pre>
              ) : (runLogs || runError) ? (
                <pre className="h-full text-[0.65rem] leading-relaxed" style={{ color: 'var(--ws-text-muted)' }}>
                  {runLogs ? formatLogs(runLogs) : ''}
                  {runError ? `\n[ERROR] ${runError}` : ''}
                </pre>
              ) : (
                <pre className="h-full text-[0.65rem] leading-relaxed" style={{ color: 'var(--ws-text-dim)' }}>
                  Waiting for run to complete...
                </pre>
              )}
            </div>
          )}
          {centerTab === "data" && (
            <div className="h-full">
              {!selectedRunId ? (
                <pre className="h-full text-[0.65rem] leading-relaxed" style={{ color: 'var(--ws-text-dim)' }}>
                  Run the extractor to see results.
                </pre>
              ) : runResults ? (
                <DataTable results={runResults} />
              ) : runError ? (
                <pre className="h-full text-[0.65rem] leading-relaxed" style={{ color: 'var(--ws-danger)' }}>
                  Run failed — no data extracted.
                </pre>
              ) : (
                <pre className="h-full text-[0.65rem] leading-relaxed" style={{ color: 'var(--ws-text-dim)' }}>
                  Waiting for run to complete...
                </pre>
              )}
            </div>
          )}
          {centerTab === "config" && (
            <div className="h-full">
              {!selectedRunId ? (
                <pre className="h-full text-[0.65rem] leading-relaxed" style={{ color: 'var(--ws-text-dim)' }}>
                  Select a run to see config overrides.
                </pre>
              ) : runResults ? (
                <ConfigDiffView results={runResults} />
              ) : (
                <pre className="h-full text-[0.65rem] leading-relaxed" style={{ color: 'var(--ws-text-dim)' }}>
                  Waiting for run to complete...
                </pre>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Inputs panel ──────────────────── */}
      <div
        className="flex w-[280px] shrink-0 flex-col overflow-hidden"
        style={{ borderLeft: '1px solid var(--ws-border)' }}
      >
        {sourceId ? (
          <InputsPanel
            inputs={inputs.map((i) => ({ ...i, inputData: (i.inputData ?? {}) as Record<string, unknown> }))}
            sourceId={sourceId}
            onSave={onSaveInput}
            onUpdate={onUpdateInput}
            onDelete={onDeleteInput}
            onRun={onRunInput}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-3">
            <span className="text-[0.65rem]" style={{ color: 'var(--ws-text-dim)' }}>Legacy extractor inputs</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Config Diff View ──────────────────────────────── */

function ConfigDiffView({ results }: { results: unknown }) {
  const [showAll, setShowAll] = useState(false);
  const res = results as Record<string, unknown> | null;
  const snapshot = res?.configSnapshot as {
    overrides?: Array<{ key: string; from: unknown; to: unknown }>;
    merged?: Record<string, unknown>;
  } | undefined;

  if (!snapshot) {
    return (
      <pre className="h-full text-[0.65rem] leading-relaxed" style={{ color: 'var(--ws-text-dim)' }}>
        No config data available for this run.
      </pre>
    );
  }

  const overrides = snapshot.overrides ?? [];
  const merged = snapshot.merged ?? {};

  const formatValue = (v: unknown): string => {
    if (v === undefined) return '(unset)';
    if (v === null) return 'null';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  return (
    <div className="h-full overflow-auto">
      {overrides.length === 0 ? (
        <div className="px-3 py-4 text-[0.65rem]" style={{ color: 'var(--ws-text-dim)' }}>
          No parameter overrides — using domain defaults.
        </div>
      ) : (
        <table className="w-full text-[0.6rem]" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ws-border)' }}>
              <th className="px-3 py-1.5 text-left font-semibold" style={{ color: 'var(--ws-text-muted)' }}>Parameter</th>
              <th className="px-3 py-1.5 text-left font-semibold" style={{ color: 'var(--ws-text-dim)' }}>Domain Default</th>
              <th className="px-3 py-1.5 text-left font-semibold" style={{ color: 'var(--ws-accent)' }}>Source Override</th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((o) => (
              <tr key={o.key} style={{ borderBottom: '1px solid var(--ws-border-subtle)' }}>
                <td className="px-3 py-1.5 font-medium" style={{ color: 'var(--ws-text)' }}>{o.key}</td>
                <td className="px-3 py-1.5" style={{ color: 'var(--ws-text-dim)', textDecoration: 'line-through' }}>
                  {formatValue(o.from)}
                </td>
                <td className="px-3 py-1.5 font-medium" style={{ color: 'var(--ws-accent)' }}>
                  {formatValue(o.to)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Collapsible full merged params */}
      <div style={{ borderTop: '1px solid var(--ws-border-subtle)' }}>
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[0.6rem] transition-colors hover:bg-[var(--ws-surface-hover)]"
          style={{ color: 'var(--ws-text-dim)' }}
        >
          {showAll ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
          All merged parameters
        </button>
        {showAll && (
          <pre className="px-3 pb-3 text-[0.6rem] leading-relaxed" style={{ color: 'var(--ws-text-muted)' }}>
            {JSON.stringify(merged, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ── Data Table ─────────────────────────────────────── */

function DataTable({ results }: { results: unknown }) {
  const res = results as Record<string, unknown> | null;
  const records = (res?.records ?? []) as Record<string, string | null>[];

  if (records.length === 0) {
    return (
      <pre className="h-full text-[0.65rem] leading-relaxed" style={{ color: 'var(--ws-text-dim)' }}>
        No records extracted.
      </pre>
    );
  }

  const columns = Object.keys(records[0]);

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-[0.6rem]" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--ws-border)' }}>
            <th className="px-2 py-1 text-left font-semibold" style={{ color: 'var(--ws-text-dim)', width: 32 }}>#</th>
            {columns.map((col) => (
              <th
                key={col}
                className="px-2 py-1 text-left font-semibold"
                style={{ color: 'var(--ws-text-muted)' }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--ws-border-subtle)' }}>
              <td className="px-2 py-1 tabular-nums" style={{ color: 'var(--ws-text-dim)' }}>{i + 1}</td>
              {columns.map((col) => (
                <td key={col} className="max-w-[300px] truncate px-2 py-1" style={{ color: 'var(--ws-text)' }} title={record[col] ?? ''}>
                  {record[col] ?? <span style={{ color: 'var(--ws-text-dim)' }}>null</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────── */

function RunStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2Icon className="size-3 shrink-0" style={{ color: 'var(--ws-success)' }} />;
    case "failed":
      return <XCircleIcon className="size-3 shrink-0" style={{ color: 'var(--ws-danger)' }} />;
    case "running":
      return <LoaderIcon className="size-3 shrink-0 animate-spin" style={{ color: 'var(--ws-accent)' }} />;
    default:
      return <ClockIcon className="size-3 shrink-0" style={{ color: 'var(--ws-text-dim)' }} />;
  }
}

function formatLogs(logsJson: string): string {
  try {
    const entries = JSON.parse(logsJson) as LogEntry[];
    return entries
      .map((e) => {
        const time = e.timestamp.split('T')[1]?.replace('Z', '') ?? e.timestamp;
        const level = e.level.toUpperCase().padEnd(5);
        return `[${time}] [${level}] ${e.message}`;
      })
      .join('\n');
  } catch {
    return logsJson;
  }
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
