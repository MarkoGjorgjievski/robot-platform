"use client";

import { useState } from "react";
import { CheckCircle2Icon, XCircleIcon, LoaderIcon, ClockIcon, CircleDotIcon } from "lucide-react";

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

interface BottomPanelProps {
  runs: Run[];
  inputs: InputEntry[];
  selectedInputId: string | null;
  onSelectInput: (id: string) => void;
}

type CenterTab = "output" | "data";

export function BottomPanel({ runs, inputs, selectedInputId, onSelectInput }: BottomPanelProps) {
  const [centerTab, setCenterTab] = useState<CenterTab>("output");
  const selectedInput = inputs.find((i) => i.id === selectedInputId);

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
              <a
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-[var(--ws-surface-hover)]"
                style={{ borderBottom: '1px solid var(--ws-border-subtle)' }}
              >
                <RunStatusIcon status={run.status} />
                <span className="min-w-0 flex-1 truncate text-[0.65rem]" style={{ color: 'var(--ws-text-muted)' }}>
                  {run.inputLabel ?? run.id.slice(0, 8)}
                </span>
                <span className="shrink-0 text-[0.55rem] tabular-nums" style={{ color: 'var(--ws-text-dim)' }}>
                  {run.startedAt ? formatRelativeTime(run.startedAt) : "\u2014"}
                </span>
              </a>
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
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto p-3">
          {centerTab === "output" && (
            <div className="h-full">
              <pre
                className="h-full text-[0.65rem] leading-relaxed"
                style={{ color: 'var(--ws-text-muted)' }}
              >
                <span style={{ color: 'var(--ws-text-dim)' }}>
                  {/* Placeholder - will show crawler logs */}
                  {`[info] Crawler output logs will appear here.\n[info] Select an input and run to see output.`}
                </span>
              </pre>
            </div>
          )}
          {centerTab === "data" && (
            <div className="h-full">
              <pre
                className="h-full text-[0.65rem] leading-relaxed"
                style={{ color: 'var(--ws-text-muted)' }}
              >
                <span style={{ color: 'var(--ws-text-dim)' }}>
                  {/* Placeholder - will show matched selector data */}
                  {`// Extracted data from matched selectors will appear here.\n// Run the extractor to see results.`}
                </span>
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Inputs selector ──────────────────── */}
      <div
        className="flex w-[280px] shrink-0 flex-col overflow-hidden"
        style={{ borderLeft: '1px solid var(--ws-border)' }}
      >
        <div className="ws-group-header" style={{ cursor: 'default' }}>
          Inputs
          <span className="ml-auto text-[0.55rem] opacity-60">{inputs.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {inputs.length === 0 ? (
            <div className="flex h-full items-center justify-center px-3">
              <span className="text-[0.65rem]" style={{ color: 'var(--ws-text-dim)' }}>No inputs configured</span>
            </div>
          ) : (
            inputs.map((input) => {
              const isSelected = input.id === selectedInputId;
              const data = input.inputData as Record<string, unknown> | null;
              // Build a one-line summary from inputData
              const summary = data
                ? Object.entries(data)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join("  ")
                : input.label;

              return (
                <button
                  key={input.id}
                  type="button"
                  onClick={() => onSelectInput(input.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors"
                  style={{
                    borderBottom: '1px solid var(--ws-border-subtle)',
                    background: isSelected ? 'var(--ws-accent-surface)' : 'transparent',
                    borderLeft: isSelected ? '2px solid var(--ws-accent)' : '2px solid transparent',
                  }}
                >
                  <CircleDotIcon
                    className="size-3 shrink-0"
                    style={{ color: isSelected ? 'var(--ws-accent)' : 'var(--ws-text-dim)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.65rem] font-medium" style={{ color: isSelected ? 'var(--ws-text)' : 'var(--ws-text-muted)' }}>
                      {input.label}
                    </div>
                    <div className="truncate text-[0.55rem]" style={{ color: 'var(--ws-text-dim)' }}>
                      {summary}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
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
