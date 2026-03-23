"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  ImageIcon,
  PlayIcon,
  PauseIcon,
  PanelRightIcon,
  SkipForwardIcon,
} from "lucide-react";

interface RunResult {
  screenshotBase64?: string;
  htmlLength?: number;
  finalUrl?: string;
  responseStatus?: number;
}

interface RenderedViewerProps {
  html: string | null;
  runId?: string | null;
  results: RunResult | null;
  replayData?: string | null;
  runStatus?: string;
  highlightSelector?: { type: "css" | "xpath"; value: string } | null;
}

type ViewTab = "replay" | "screenshot";

export function RenderedViewer({ html, runId, results, replayData, runStatus, highlightSelector }: RenderedViewerProps) {
  const hasReplay = !!replayData;
  const [tab, setTab] = useState<ViewTab>(hasReplay ? "replay" : "screenshot");
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // Update tab when replay data becomes available
  useEffect(() => {
    if (hasReplay) setTab("replay");
  }, [hasReplay]);

  if (!html && !results && !replayData) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-full items-center justify-center">
          <p className="text-[0.7rem]" style={{ color: "var(--ws-text-dim)" }}>
            Select a run to view results.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div
        className="flex items-center gap-1 px-3 py-1.5 shrink-0"
        style={{ background: "var(--ws-panel-header)", borderBottom: "1px solid var(--ws-border)" }}
      >
        {hasReplay && (
          <button
            className="ws-tab"
            data-state={tab === "replay" ? "active" : "inactive"}
            onClick={() => setTab("replay")}
          >
            <PlayIcon className="mr-1 inline size-3" />
            Replay
          </button>
        )}
        <button
          className="ws-tab"
          data-state={tab === "screenshot" ? "active" : "inactive"}
          onClick={() => setTab("screenshot")}
        >
          <ImageIcon className="mr-1 inline size-3" />
          Screenshot
        </button>

        <span className="flex-1" />

        {results?.finalUrl && (
          <span className="mr-2 truncate text-[0.55rem]" style={{ color: "var(--ws-text-dim)", maxWidth: 300 }}>
            {results.finalUrl}
          </span>
        )}

        {tab === "replay" && (
          <button
            onClick={() => setInspectorOpen(!inspectorOpen)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6rem] transition-colors"
            style={{
              color: inspectorOpen ? "var(--ws-accent)" : "var(--ws-text-muted)",
              background: inspectorOpen ? "var(--ws-accent-surface)" : "transparent",
              border: `1px solid ${inspectorOpen ? "var(--ws-accent)" : "var(--ws-border)"}`,
            }}
          >
            <PanelRightIcon className="size-3" />
            Inspector
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {tab === "replay" && replayData && (
          <ReplayView
            replayData={replayData}
            highlightSelector={highlightSelector}
            inspectorOpen={inspectorOpen}
          />
        )}

        {tab === "replay" && !replayData && html && (
          <FallbackHtmlView html={html} runId={runId} />
        )}

        {tab === "screenshot" && results?.screenshotBase64 && (
          <div className="flex-1 overflow-auto p-4">
            <img
              src={`data:image/png;base64,${results.screenshotBase64}`}
              alt="Page screenshot"
              className="max-w-full rounded border"
              style={{ borderColor: "var(--ws-border)" }}
            />
          </div>
        )}

        {tab === "screenshot" && !results?.screenshotBase64 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[0.7rem]" style={{ color: "var(--ws-text-dim)" }}>No screenshot available.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Fallback: static HTML view (for runs without replay data) ──── */

function FallbackHtmlView({ html, runId }: { html: string; runId?: string | null }) {
  return (
    <div className="h-full w-full overflow-hidden">
      <iframe
        {...(runId
          ? { src: `/api/runs/${runId}/html` }
          : { srcDoc: html }
        )}
        sandbox="allow-scripts allow-same-origin"
        scrolling="yes"
        className="h-full w-full border-0"
        style={{ overflow: "auto" }}
        title="Rendered page"
      />
    </div>
  );
}

/* ── Replay view with custom controls + inspector ──────────────── */

function ReplayView({
  replayData,
  highlightSelector,
  inspectorOpen,
}: {
  replayData: string;
  highlightSelector?: { type: "css" | "xpath"; value: string } | null;
  inspectorOpen: boolean;
}) {
  const events = useMemo(() => {
    try { return JSON.parse(replayData); } catch { return []; }
  }, [replayData]);

  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const replayerRef = useRef<any>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [iframeDoc, setIframeDoc] = useState<Document | null>(null);
  const rafRef = useRef<number>(0);

  // Initialize replayer
  useEffect(() => {
    if (!containerRef.current || events.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let replayer: any;

    import("@rrweb/replay").then((mod) => {
      if (!containerRef.current) return;

      // rrweb replayer applies its own inline styles, no external CSS needed

      replayer = new mod.Replayer(events, {
        root: containerRef.current,
        skipInactive: true,
        showWarning: false,
        blockClass: "rr-block",
        liveMode: false,
        insertStyleRules: [
          "html, body { overflow: auto !important; height: auto !important; }",
        ],
      });

      replayerRef.current = replayer;

      // Calculate total duration
      const meta = replayer.getMetaData();
      setTotalTime(meta.totalTime ?? 0);

      // Render first frame paused
      replayer.pause(0);
      setPlaying(false);

      // Get iframe doc for inspector
      if (replayer.iframe?.contentDocument) {
        setIframeDoc(replayer.iframe.contentDocument);
      }

      // Strip all rrweb wrapper chrome — make iframe fill our container directly
      if (replayer.wrapper) {
        const wrapper = replayer.wrapper as HTMLElement;
        wrapper.style.cssText = "width:100%;height:100%;transform:none;overflow:hidden;position:relative;";
      }
      if (replayer.iframe) {
        const iframe = replayer.iframe as HTMLIFrameElement;
        iframe.style.cssText = "width:100%;height:100%;border:none;display:block;overflow:auto;";
        iframe.setAttribute("scrolling", "yes");
      }
      // Hide the mouse canvas overlay that covers the replay
      const canvas = containerRef.current?.querySelector("canvas");
      if (canvas) {
        (canvas as HTMLElement).style.display = "none";
      }
      // Also fix the root container rrweb creates
      const rrwebRoot = containerRef.current?.querySelector(".replayer-wrapper")?.parentElement;
      if (rrwebRoot && rrwebRoot !== containerRef.current) {
        (rrwebRoot as HTMLElement).style.cssText = "width:100%;height:100%;overflow:hidden;";
      }
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      replayer?.destroy?.();
      replayerRef.current = null;
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [events]);

  // Track current time while playing
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    const tick = () => {
      const r = replayerRef.current;
      if (r) {
        const t = r.getCurrentTime?.() ?? r.timer?.timeOffset ?? 0;
        setCurrentTime(t);

        // Update iframe doc ref
        if (r.iframe?.contentDocument && r.iframe.contentDocument !== iframeDoc) {
          setIframeDoc(r.iframe.contentDocument);
        }

        // Check if replay ended
        if (t >= totalTime && totalTime > 0) {
          setPlaying(false);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, totalTime, iframeDoc]);

  // Apply highlight selector to replay iframe DOM
  useEffect(() => {
    if (!iframeDoc) return;

    // Clear previous highlights
    iframeDoc.querySelectorAll("[data-rp-highlight]").forEach((el) => {
      (el as HTMLElement).style.outline = "";
      (el as HTMLElement).style.backgroundColor = "";
      el.removeAttribute("data-rp-highlight");
    });

    if (!highlightSelector?.value) return;

    let els: Element[] = [];
    try {
      if (highlightSelector.type === "css") {
        els = Array.from(iframeDoc.querySelectorAll(highlightSelector.value));
      } else if (highlightSelector.type === "xpath") {
        const result = iframeDoc.evaluate(
          highlightSelector.value, iframeDoc, null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null,
        );
        for (let i = 0; i < result.snapshotLength; i++) {
          const n = result.snapshotItem(i);
          if (n) els.push(n as Element);
        }
      }
    } catch { /* invalid selector */ }

    for (const el of els) {
      const htmlEl = el as HTMLElement;
      if (!htmlEl.style) continue; // skip non-HTML nodes (text, comment, etc.)
      htmlEl.style.outline = "2px solid #3b82f6";
      htmlEl.style.backgroundColor = "rgba(59,130,246,0.1)";
      htmlEl.setAttribute("data-rp-highlight", "1");
    }
    if (els[0] && (els[0] as HTMLElement).scrollIntoView) {
      (els[0] as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightSelector, iframeDoc, currentTime]);

  const togglePlay = useCallback(() => {
    const r = replayerRef.current;
    if (!r) return;
    if (playing) {
      r.pause();
      setPlaying(false);
      // Update iframe doc for inspector
      if (r.iframe?.contentDocument) setIframeDoc(r.iframe.contentDocument);
    } else {
      // If at the end, restart
      if (currentTime >= totalTime && totalTime > 0) {
        r.play(0);
      } else {
        r.play(currentTime);
      }
      setPlaying(true);
    }
  }, [playing, currentTime, totalTime]);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const r = replayerRef.current;
    if (!r) return;
    const t = Number(e.target.value);
    r.pause(t);
    setCurrentTime(t);
    setPlaying(false);
    if (r.iframe?.contentDocument) setIframeDoc(r.iframe.contentDocument);
  }, []);

  const cycleSpeed = useCallback(() => {
    const r = replayerRef.current;
    if (!r) return;
    const speeds = [1, 2, 4, 8];
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
    setSpeed(next);
    r.setConfig?.({ speed: next });
    if (playing) {
      r.pause();
      r.play(currentTime);
    }
  }, [speed, playing, currentTime]);

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  if (events.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[0.7rem]" style={{ color: "var(--ws-text-dim)" }}>No replay data.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* Replay content area */}
      <div className="flex flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className={inspectorOpen ? "flex-1 overflow-hidden" : "h-full w-full overflow-hidden"}
          style={{ background: "#fff" }}
        />
        {inspectorOpen && iframeDoc && (
          <LiveDomInspector doc={iframeDoc} key={currentTime} />
        )}
      </div>

      {/* Playback controls */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 shrink-0"
        style={{
          background: "var(--ws-panel-header)",
          borderTop: "1px solid var(--ws-border)",
        }}
      >
        <button
          onClick={togglePlay}
          className="flex items-center justify-center rounded p-1 transition-colors hover:bg-[var(--ws-surface-hover)]"
          style={{ color: "var(--ws-text)" }}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
        </button>

        <span className="text-[0.6rem] tabular-nums" style={{ color: "var(--ws-text-muted)", width: 40 }}>
          {formatTime(currentTime)}
        </span>

        <input
          type="range"
          min={0}
          max={totalTime}
          value={currentTime}
          onChange={handleScrub}
          className="flex-1"
          style={{ accentColor: "var(--ws-accent)" }}
        />

        <span className="text-[0.6rem] tabular-nums" style={{ color: "var(--ws-text-muted)", width: 40 }}>
          {formatTime(totalTime)}
        </span>

        <button
          onClick={cycleSpeed}
          className="rounded px-1.5 py-0.5 text-[0.6rem] font-semibold transition-colors hover:bg-[var(--ws-surface-hover)]"
          style={{
            color: speed > 1 ? "var(--ws-accent)" : "var(--ws-text-muted)",
            border: "1px solid var(--ws-border-subtle)",
          }}
          title="Playback speed"
        >
          {speed}x
        </button>
      </div>
    </div>
  );
}

/* ── Live DOM Inspector — reads from the replay iframe document ── */

function LiveDomInspector({ doc }: { doc: Document }) {
  return (
    <div
      className="flex w-[42%] shrink-0 flex-col overflow-hidden"
      style={{ borderLeft: "1px solid var(--ws-border)", background: "var(--ws-surface)" }}
    >
      <div
        className="flex items-center px-3 py-1.5"
        style={{ borderBottom: "1px solid var(--ws-border)" }}
      >
        <span className="text-[0.6rem] font-semibold uppercase tracking-wider" style={{ color: "var(--ws-text-muted)" }}>
          Elements
        </span>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {doc.documentElement ? (
          <div className="font-mono text-[0.6rem] leading-relaxed">
            <LiveDomNode node={doc.documentElement} depth={0} />
          </div>
        ) : (
          <p className="text-[0.6rem]" style={{ color: "var(--ws-text-dim)" }}>No DOM available</p>
        )}
      </div>
    </div>
  );
}

function LiveDomNode({ node, depth }: { node: Element; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const childElements = Array.from(node.children);
  const hasChildren = childElements.length > 0;
  const indent = depth * 12;

  // Skip rrweb internal elements
  if (node.classList?.contains("replayer-mouse") || node.classList?.contains("replayer-wrapper")) {
    return null;
  }

  const tagName = node.tagName?.toLowerCase() ?? "unknown";

  const attrs = Array.from(node.attributes || [])
    .filter((a) => a.name !== "xmlns" && !a.name.startsWith("data-rr"))
    .slice(0, 5)
    .map((a) => (
      <span key={a.name}>
        {" "}
        <span style={{ color: "var(--ws-text-dim)" }}>{a.name}</span>
        <span style={{ color: "var(--ws-text-dim)" }}>=</span>
        <span style={{ color: "var(--ws-accent)" }}>&quot;{a.value.slice(0, 40)}{a.value.length > 40 ? "..." : ""}&quot;</span>
      </span>
    ));

  const textContent = !hasChildren && node.textContent?.trim()
    ? node.textContent.trim().slice(0, 60)
    : null;

  return (
    <div>
      <div
        className="flex cursor-pointer items-start hover:bg-[var(--ws-surface-hover)]"
        style={{ paddingLeft: indent }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <span className="mr-1 w-3 shrink-0 text-center" style={{ color: "var(--ws-text-dim)" }}>
          {hasChildren ? (expanded ? "\u25BC" : "\u25B6") : " "}
        </span>
        <span>
          <span style={{ color: "var(--ws-text-muted)" }}>&lt;</span>
          <span style={{ color: "var(--ws-warning)" }}>{tagName}</span>
          {attrs}
          <span style={{ color: "var(--ws-text-muted)" }}>&gt;</span>
          {textContent && (
            <span style={{ color: "var(--ws-text)" }}>{textContent}</span>
          )}
        </span>
      </div>
      {expanded && childElements.map((child, i) => (
        <LiveDomNode key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}
