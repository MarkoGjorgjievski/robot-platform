"use client";

import { CodeIcon, EyeIcon } from "lucide-react";

interface DomViewerProps {
  lastRunId?: string;
  lastRunStatus?: string;
}

export function DomViewer({ lastRunId, lastRunStatus }: DomViewerProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: 'var(--ws-panel-header)', borderBottom: '1px solid var(--ws-border)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ws-text)' }}>
            DOM Viewer
          </span>
          {lastRunId && (
            <span className={`ws-badge ${lastRunStatus === 'completed' ? 'ws-badge-green' : lastRunStatus === 'failed' ? 'ws-badge-red' : 'ws-badge-gray'}`}>
              {lastRunStatus ?? 'unknown'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6rem] transition-colors"
            style={{ color: 'var(--ws-text-muted)', background: 'var(--ws-surface-hover)' }}
            title="Toggle DOM/Visual view"
          >
            <CodeIcon className="size-3" />
            <span>DOM</span>
          </button>
          <button
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6rem] transition-colors"
            style={{ color: 'var(--ws-text-dim)' }}
            title="Toggle DOM/Visual view"
          >
            <EyeIcon className="size-3" />
            <span>Visual</span>
          </button>
        </div>
      </div>

      {/* DOM content area */}
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-4 px-8 text-center">
          {/* Decorative DOM tree illustration */}
          <div className="relative" style={{ color: 'var(--ws-border)' }}>
            <svg width="120" height="100" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="40" y="4" width="40" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
              <text x="60" y="14" textAnchor="middle" fill="currentColor" fontSize="7" fontFamily="monospace">html</text>
              <line x1="60" y1="18" x2="35" y2="34" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2" />
              <line x1="60" y1="18" x2="85" y2="34" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2" />
              <rect x="15" y="34" width="40" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
              <text x="35" y="44" textAnchor="middle" fill="currentColor" fontSize="7" fontFamily="monospace">head</text>
              <rect x="65" y="34" width="40" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
              <text x="85" y="44" textAnchor="middle" fill="currentColor" fontSize="7" fontFamily="monospace">body</text>
              <line x1="85" y1="48" x2="70" y2="64" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2" />
              <line x1="85" y1="48" x2="100" y2="64" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2" />
              <rect x="50" y="64" width="40" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
              <text x="70" y="74" textAnchor="middle" fill="currentColor" fontSize="7" fontFamily="monospace" opacity="0.6">div</text>
              <rect x="80" y="64" width="36" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
              <text x="98" y="74" textAnchor="middle" fill="currentColor" fontSize="7" fontFamily="monospace" opacity="0.4">div</text>
            </svg>
          </div>

          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--ws-text-muted)' }}>
              DOM representation from last run
            </p>
            <p className="mt-1 text-[0.65rem] leading-relaxed" style={{ color: 'var(--ws-text-dim)' }}>
              {lastRunId
                ? "Run a new extraction to capture the page DOM tree."
                : "No runs recorded yet. Execute an extraction to see the DOM snapshot here."}
            </p>
          </div>

          <div
            className="mt-1 rounded px-3 py-1.5 text-[0.65rem] font-medium"
            style={{
              background: 'var(--ws-accent-surface)',
              color: 'var(--ws-accent)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
            }}
          >
            Coming soon
          </div>
        </div>
      </div>
    </div>
  );
}
