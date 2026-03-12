"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  FileCodeIcon,
  SettingsIcon,
  TablePropertiesIcon,
  PanelBottomIcon,
  GripHorizontalIcon,
  WandSparklesIcon,
} from "lucide-react";
import { SchemaPanel } from "./schema-panel";
import { DomViewer } from "./dom-viewer";
import { ConfigPanel } from "./config-panel";
import { TransformPanel } from "./transform-panel";
import { BottomPanel } from "./bottom-panel";
import { RecorderBar } from "./recorder-bar";

interface ExtractorWorkspaceProps {
  extractor: {
    id: string;
    orgId: string;
    domainId: string;
    country: string;
    variant: string;
    robotTemplate: string;
    parameters: unknown;
    isActive: boolean;
    org: { name: string };
    domain: { name: string };
    inputs: { id: string; label: string; inputData: unknown; createdAt: Date }[];
    credentials: { id: string; environment: string; username: string | null; createdAt: Date }[];
  };
  orgs: { id: string; name: string }[];
  domains: { id: string; name: string }[];
  domainDefaults: Record<string, unknown>;
  schemas: Record<string, unknown>;
  jsOverrides: Record<string, string>;
  schemaYAML?: string;
  overrideId?: string;
  hasGoto2: boolean;
  hasBeforeExtract: boolean;
  hasExtract: boolean;
  hasTransform: boolean;
  recentRuns: {
    id: string;
    status: string;
    inputLabel?: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }[];
}

type SidebarPanel = "config" | "schema" | "transform" | null;

export function ExtractorWorkspace({
  extractor,
  orgs,
  domains,
  domainDefaults,
  schemas,
  jsOverrides,
  schemaYAML,
  overrideId,
  hasGoto2,
  hasBeforeExtract,
  hasExtract,
  hasTransform,
  recentRuns,
}: ExtractorWorkspaceProps) {
  const [activePanel, setActivePanel] = useState<SidebarPanel>("config");
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [bottomHeight, setBottomHeight] = useState(220);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [selectedInputId, setSelectedInputId] = useState<string | null>(
    extractor.inputs[0]?.id ?? null
  );

  const schemaTabName = schemaYAML ?? Object.keys(schemas)[0];
  const schemaData = schemaTabName ? schemas[schemaTabName] : undefined;
  const lastRun = recentRuns[0];

  const togglePanel = (panel: SidebarPanel) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

  const toggleBottom = () => {
    setBottomOpen((prev) => !prev);
  };

  const handleSidebarResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        setSidebarWidth(Math.max(260, Math.min(550, startW + delta)));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [sidebarWidth]
  );

  const handleBottomResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = bottomHeight;

      const onMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        setBottomHeight(Math.max(120, Math.min(500, startH + delta)));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [bottomHeight]
  );

  const useTransform = Boolean((extractor.parameters as Record<string, unknown>)?.useTransform);

  const activityItems: Array<{
    id: SidebarPanel | "bottom";
    icon: React.ReactNode;
    title: string;
    hidden?: boolean;
  }> = [
    {
      id: "config",
      icon: <SettingsIcon className="size-[18px]" />,
      title: "Configuration",
    },
    {
      id: "schema",
      icon: <TablePropertiesIcon className="size-[18px]" />,
      title: "Schema",
    },
    {
      id: "transform",
      icon: <WandSparklesIcon className="size-[18px]" />,
      title: "Transform",
      hidden: !hasTransform,
    },
    {
      id: "bottom",
      icon: <PanelBottomIcon className="size-[18px]" />,
      title: "Terminal Panel",
    },
  ];

  return (
    <div className="workspace flex h-screen flex-col" style={{ fontFamily: "var(--font-mono), 'JetBrains Mono', monospace" }}>
      {/* ── Top Bar ─────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 py-2 shrink-0"
        style={{
          background: 'var(--ws-panel-header)',
          borderBottom: '1px solid var(--ws-border)',
        }}
      >
        <Link
          href="/extractors"
          className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--ws-surface-hover)]"
          style={{ color: 'var(--ws-text-muted)' }}
        >
          <ArrowLeftIcon className="size-3" />
          Back
        </Link>

        <div className="h-4 w-px" style={{ background: 'var(--ws-border)' }} />

        <div className="flex items-center gap-2">
          <FileCodeIcon className="size-3.5" style={{ color: 'var(--ws-accent)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--ws-text)' }}>
            {extractor.org.name}
          </span>
          <span style={{ color: 'var(--ws-text-dim)' }}>/</span>
          <span className="text-xs" style={{ color: 'var(--ws-text)' }}>
            {extractor.domain.name}
          </span>
          <span className="ws-badge ws-badge-gray">{extractor.country}</span>
          {extractor.variant !== "default" && (
            <span className="ws-badge ws-badge-blue">{extractor.variant}</span>
          )}
        </div>

        <div className="flex-1" />

        <a
          href={`/api/extractors/${extractor.id}/yaml`}
          className="rounded px-2 py-1 text-[0.65rem] font-medium uppercase tracking-wider transition-colors hover:bg-[var(--ws-surface-hover)]"
          style={{ color: 'var(--ws-text-muted)', background: 'var(--ws-surface-hover)' }}
        >
          Export YAML
        </a>
      </div>

      {/* ── Main body: content + activity bar ────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Content area (everything except activity bar) */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Upper section: DOM viewer + optional sidebar */}
          <div className="flex flex-1 overflow-hidden">
            {/* DOM Viewer — fills remaining space */}
            <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--ws-bg)' }}>
              <DomViewer
                lastRunId={lastRun?.id}
                lastRunStatus={lastRun?.status}
              />
            </div>

            {/* Sidebar resize handle */}
            {activePanel && (
              <div
                className="ws-gutter flex w-[3px] shrink-0 cursor-col-resize items-center justify-center"
                onMouseDown={handleSidebarResize}
              />
            )}

            {/* Right sidebar — config or schema */}
            {activePanel && (
              <div
                className="flex shrink-0 flex-col overflow-hidden"
                style={{
                  width: sidebarWidth,
                  background: 'var(--ws-surface)',
                }}
              >
                {activePanel === "config" && (
                  <ConfigPanel
                    extractor={extractor}
                    orgs={orgs}
                    domains={domains}
                    domainDefaults={domainDefaults}
                    jsOverrides={jsOverrides}
                    hasGoto2={hasGoto2}
                    hasBeforeExtract={hasBeforeExtract}
                    hasExtract={hasExtract}
                    hasTransform={hasTransform}
                    credentials={extractor.credentials}
                  />
                )}
                {activePanel === "schema" && (
                  <SchemaPanel
                    schemaName={schemaTabName}
                    schema={schemaData as Record<string, unknown> | undefined}
                    overrideId={overrideId}
                  />
                )}
                {activePanel === "transform" && (
                  <TransformPanel
                    code={jsOverrides.transform ?? ""}
                    enabled={useTransform}
                  />
                )}
              </div>
            )}
          </div>

          {/* Bottom resize handle */}
          {bottomOpen && (
            <div
              className="ws-gutter flex h-[3px] shrink-0 cursor-row-resize items-center justify-center"
              onMouseDown={handleBottomResize}
            >
              <GripHorizontalIcon className="size-3 opacity-0 transition-opacity hover:opacity-40" style={{ color: 'var(--ws-text-dim)' }} />
            </div>
          )}

          {/* Bottom panel */}
          {bottomOpen && (
            <div
              className="shrink-0 overflow-hidden"
              style={{
                height: bottomHeight,
                background: 'var(--ws-surface)',
                borderTop: '1px solid var(--ws-border)',
              }}
            >
              <BottomPanel
                runs={recentRuns}
                inputs={extractor.inputs}
                selectedInputId={selectedInputId}
                onSelectInput={setSelectedInputId}
              />
            </div>
          )}

          {/* Recorder bar */}
          <div className="shrink-0">
            <RecorderBar lastRunId={lastRun?.id} />
          </div>
        </div>

        {/* ── Activity Bar (far right) ────────────────── */}
        <div
          className="flex shrink-0 flex-col items-center gap-0.5 py-2"
          style={{
            width: 40,
            background: 'var(--ws-panel-header)',
            borderLeft: '1px solid var(--ws-border)',
          }}
        >
          {activityItems.filter((i) => !i.hidden).map((item) => {
            const isActive =
              item.id === "bottom"
                ? bottomOpen
                : activePanel === item.id;

            return (
              <button
                key={item.id}
                title={item.title}
                onClick={() => {
                  if (item.id === "bottom") {
                    toggleBottom();
                  } else {
                    togglePanel(item.id as SidebarPanel);
                  }
                }}
                className="relative flex items-center justify-center rounded transition-colors"
                style={{
                  width: 32,
                  height: 32,
                  color: isActive ? 'var(--ws-text)' : 'var(--ws-text-dim)',
                  background: isActive ? 'var(--ws-surface-hover)' : 'transparent',
                }}
              >
                {item.icon}
                {/* Active indicator bar on the right edge */}
                {isActive && (
                  <span
                    className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-l"
                    style={{ background: 'var(--ws-accent)' }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
