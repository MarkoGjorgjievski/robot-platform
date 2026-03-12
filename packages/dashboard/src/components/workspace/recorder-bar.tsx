"use client";

import {
  PlayIcon,
  PauseIcon,
  SquareIcon,
  SkipForwardIcon,
  CircleIcon,
} from "lucide-react";

interface RecorderBarProps {
  lastRunId?: string;
}

export function RecorderBar({ lastRunId }: RecorderBarProps) {
  return (
    <div
      className="flex items-center gap-4 px-4"
      style={{
        height: 38,
        background: 'var(--ws-panel-header)',
        borderTop: '1px solid var(--ws-border)',
      }}
    >
      {/* Transport controls */}
      <div className="flex items-center gap-1">
        <button
          className="flex items-center justify-center rounded p-1.5 transition-colors"
          style={{ color: 'var(--ws-text-muted)' }}
          title="Play"
        >
          <PlayIcon className="size-3.5" />
        </button>
        <button
          className="flex items-center justify-center rounded p-1.5 transition-colors"
          style={{ color: 'var(--ws-text-dim)' }}
          title="Pause"
        >
          <PauseIcon className="size-3.5" />
        </button>
        <button
          className="flex items-center justify-center rounded p-1.5 transition-colors"
          style={{ color: 'var(--ws-text-dim)' }}
          title="Stop"
        >
          <SquareIcon className="size-3" />
        </button>
        <button
          className="flex items-center justify-center rounded p-1.5 transition-colors"
          style={{ color: 'var(--ws-text-dim)' }}
          title="Step forward"
        >
          <SkipForwardIcon className="size-3.5" />
        </button>
        <div className="mx-1 h-4 w-px" style={{ background: 'var(--ws-border)' }} />
        <button
          className="flex items-center justify-center rounded p-1.5 transition-colors"
          style={{ color: 'var(--ws-danger)' }}
          title="Record"
        >
          <CircleIcon className="size-3" fill="currentColor" />
        </button>
      </div>

      {/* Timeline track */}
      <div className="flex flex-1 items-center gap-2">
        <span className="text-[0.6rem] tabular-nums" style={{ color: 'var(--ws-text-dim)' }}>
          00:00
        </span>
        <div className="relative flex-1 h-1.5 rounded-full" style={{ background: 'var(--ws-surface-hover)' }}>
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: '0%', background: 'var(--ws-accent)' }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full border-2"
            style={{
              left: '0%',
              background: 'var(--ws-bg)',
              borderColor: 'var(--ws-accent)',
            }}
          />
        </div>
        <span className="text-[0.6rem] tabular-nums" style={{ color: 'var(--ws-text-dim)' }}>
          --:--
        </span>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        {lastRunId ? (
          <span className="ws-badge ws-badge-gray">Run: {lastRunId.slice(0, 8)}</span>
        ) : (
          <span className="text-[0.6rem]" style={{ color: 'var(--ws-text-dim)' }}>No run loaded</span>
        )}
        <span
          className="text-[0.6rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ws-text-dim)' }}
        >
          Recorder
        </span>
      </div>
    </div>
  );
}
