"use client";

import { useState } from "react";
import { CodeEditor } from "./code-editor";

interface TransformPanelProps {
  code: string;
  enabled: boolean;
}

export function TransformPanel({ code, enabled }: TransformPanelProps) {
  const [value, setValue] = useState(code);

  return (
    <div className="flex h-full flex-col">
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: 'var(--ws-panel-header)', borderBottom: '1px solid var(--ws-border)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ws-text)' }}>
          transform.js
        </span>
        <span className={`ws-badge ${enabled ? 'ws-badge-green' : 'ws-badge-red'}`}>
          {enabled ? 'enabled' : 'disabled'}
        </span>
      </div>

      {/* Editor */}
      {enabled ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <CodeEditor
            value={value}
            onChange={setValue}
            maxHeight={9999}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="text-center">
            <p className="text-xs" style={{ color: 'var(--ws-text-dim)' }}>
              Transform is disabled.
            </p>
            <p className="mt-1 text-[0.6rem]" style={{ color: 'var(--ws-text-dim)' }}>
              Enable &quot;Use Transform&quot; in Config to edit.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
