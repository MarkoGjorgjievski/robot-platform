"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import { RenderedViewer } from "./rendered-viewer";
import { ConfigPanel } from "./config-panel";
import { TransformPanel } from "./transform-panel";
import { BottomPanel } from "./bottom-panel";
import { RecorderBar } from "./recorder-bar";

interface RunResult {
  screenshotBase64?: string;
  htmlLength?: number;
  finalUrl?: string;
  responseStatus?: number;
}

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
  sourceId?: string;
  recentRuns: {
    id: string;
    status: string;
    inputLabel?: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }[];
  onSaveInput?: (sourceId: string, label: string, inputData: Record<string, unknown>) => Promise<unknown>;
  onUpdateInput?: (id: string, label: string, inputData: Record<string, unknown>) => Promise<unknown>;
  onDeleteInput?: (id: string) => Promise<unknown>;
  onRunInput?: (sourceId: string, inputLabel: string) => Promise<unknown>;
  fetchRunData?: (runId: string) => Promise<{ html: string | null; logs: string | null; results: unknown; errorMessage: string | null; status: string }>;
  onUpdateSource?: (data: { id: string; isActive?: boolean; parameters?: Record<string, unknown>; domainId?: string | null; country?: string; variant?: string; robotTemplate?: string }) => Promise<void>;
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
  sourceId,
  hasTransform,
  recentRuns,
  onSaveInput,
  onUpdateInput,
  onDeleteInput,
  onRunInput,
  fetchRunData,
  onUpdateSource,
}: ExtractorWorkspaceProps) {
  const router = useRouter();
  const [activePanel, setActivePanel] = useState<SidebarPanel>("config");
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [bottomHeight, setBottomHeight] = useState(220);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunHtml, setSelectedRunHtml] = useState<string | null>(null);
  const [selectedRunResults, setSelectedRunResults] = useState<RunResult | null>(null);
  const [selectedRunStatus, setSelectedRunStatus] = useState<string | null>(null);
  const [selectedRunLogs, setSelectedRunLogs] = useState<string | null>(null);
  const [selectedRunError, setSelectedRunError] = useState<string | null>(null);
  const [highlightSelector, setHighlightSelector] = useState<{ type: "css" | "xpath"; value: string } | null>(null);
  const loadedRunIdRef = useRef<string | null>(null);

  // Poll for active runs
  useEffect(() => {
    if (!selectedRunId) return;
    const run = recentRuns.find((r) => r.id === selectedRunId);
    if (!run || run.status === "completed" || run.status === "failed") return;

    const interval = setInterval(async () => {
      router.refresh();
    }, 2000);

    return () => clearInterval(interval);
  }, [selectedRunId, recentRuns, router]);

  // Fetch run details when a completed/failed run is selected
  useEffect(() => {
    if (!selectedRunId) return;
    const run = recentRuns.find((r) => r.id === selectedRunId);
    if (!run || (run.status !== "completed" && run.status !== "failed")) {
      setSelectedRunHtml(null);
      setSelectedRunResults(null);
      setSelectedRunLogs(null);
      setSelectedRunError(null);
      setSelectedRunStatus(run?.status ?? null);
      return;
    }

    setSelectedRunStatus(run.status);

    // Guard: skip re-fetch if we already have data for this run ID
    if (loadedRunIdRef.current === selectedRunId) return;

    if (fetchRunData) {
      fetchRunData(selectedRunId).then((data) => {
        if (data) {
          setSelectedRunHtml(data.html ?? null);
          setSelectedRunResults(data.results as RunResult | null);
          setSelectedRunLogs(data.logs ?? null);
          setSelectedRunError(data.errorMessage ?? null);
          loadedRunIdRef.current = selectedRunId;
        }
      });
    }
  }, [selectedRunId, recentRuns, fetchRunData]);

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
      hidden: !hasTransform && !sourceId,
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
              <RenderedViewer
                html={selectedRunHtml}
                results={selectedRunResults}
                runStatus={selectedRunStatus ?? undefined}
                highlightSelector={highlightSelector}
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
                    sourceId={sourceId}
                    onUpdateSource={onUpdateSource}
                  />
                )}
                {activePanel === "schema" && (
                  <SchemaPanel
                    schemaName={schemaTabName}
                    schema={schemaData as Record<string, unknown> | undefined}
                    overrideId={overrideId}
                    onHighlightSelector={setHighlightSelector}
                    sourceId={sourceId}
                    onSaveSourceSchema={sourceId && onUpdateSource ? async (schema) => {
                      const currentParams = (extractor.parameters as Record<string, unknown>) ?? {};
                      await onUpdateSource!({ id: sourceId!, parameters: { ...currentParams, _schema: schema } });
                    } : undefined}
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
                sourceId={sourceId}
                selectedRunId={selectedRunId}
                onSelectRun={setSelectedRunId}
                onSaveInput={onSaveInput ?? (async () => {})}
                onUpdateInput={onUpdateInput ?? (async () => {})}
                onDeleteInput={onDeleteInput ?? (async () => {})}
                onRunInput={onRunInput ?? (async () => {})}
                runLogs={selectedRunLogs}
                runResults={selectedRunResults as Record<string, unknown> | null}
                runError={selectedRunError}
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
