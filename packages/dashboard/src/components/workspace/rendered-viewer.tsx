"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { EyeIcon, ImageIcon, PanelRightIcon } from "lucide-react";

interface RunResult {
  screenshotBase64?: string;
  htmlLength?: number;
  finalUrl?: string;
  responseStatus?: number;
}

interface RenderedViewerProps {
  html: string | null;
  results: RunResult | null;
  runStatus?: string;
  highlightSelector?: { type: "css" | "xpath"; value: string } | null;
}

type ViewTab = "rendered" | "screenshot";

// Script injected into the iframe to handle highlight messages
const HIGHLIGHT_SCRIPT = `
<script>
window.addEventListener('message', function(e) {
  if (!e.data || e.data.type !== 'highlight') return;
  // Remove old highlights
  document.querySelectorAll('[data-rp-highlight]').forEach(function(el) {
    el.style.outline = '';
    el.style.backgroundColor = '';
    el.removeAttribute('data-rp-highlight');
  });
  var sel = e.data.selector;
  if (!sel || !sel.value) return;
  var els = [];
  try {
    if (sel.type === 'css') {
      els = Array.from(document.querySelectorAll(sel.value));
    } else if (sel.type === 'xpath') {
      var result = document.evaluate(sel.value, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (var i = 0; i < result.snapshotLength; i++) els.push(result.snapshotItem(i));
    }
  } catch(ex) {}
  els.forEach(function(el) {
    if (el && el.style) {
      el.style.outline = '2px solid #3b82f6';
      el.style.backgroundColor = 'rgba(59,130,246,0.1)';
      el.setAttribute('data-rp-highlight', '1');
    }
  });
  if (els.length > 0 && els[0].scrollIntoView) {
    els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
</script>`;

function injectHighlightScript(rawHtml: string): string {
  // Inject before </body> or at end
  if (rawHtml.includes('</body>')) {
    return rawHtml.replace('</body>', HIGHLIGHT_SCRIPT + '</body>');
  }
  return rawHtml + HIGHLIGHT_SCRIPT;
}

export function RenderedViewer({ html, results, runStatus, highlightSelector }: RenderedViewerProps) {
  const [tab, setTab] = useState<ViewTab>("rendered");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Send highlight message to iframe when selector changes
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      { type: 'highlight', selector: highlightSelector ?? null },
      '*'
    );
  }, [highlightSelector]);

  if (!html && !results) {
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
        className="flex items-center gap-1 px-3 py-1.5"
        style={{ background: "var(--ws-panel-header)", borderBottom: "1px solid var(--ws-border)" }}
      >
        <button
          className="ws-tab"
          data-state={tab === "rendered" ? "active" : "inactive"}
          onClick={() => setTab("rendered")}
        >
          <EyeIcon className="mr-1 inline size-3" />
          Rendered
        </button>
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

        {tab === "rendered" && html && (
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
        {tab === "rendered" && html && (
          <>
            <div className={inspectorOpen ? "flex-1 overflow-hidden" : "h-full w-full overflow-hidden"}>
              <iframe
                ref={iframeRef}
                srcDoc={injectHighlightScript(html)}
                sandbox="allow-scripts"
                className="h-full w-full border-0"
                title="Rendered page"
              />
            </div>
            {inspectorOpen && (
              <DomInspector html={html} />
            )}
          </>
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

function DomInspector({ html }: { html: string }) {
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
        <DomTree html={html} />
      </div>
    </div>
  );
}

function DomTree({ html }: { html: string }) {
  const parser = typeof DOMParser !== "undefined" ? new DOMParser() : null;
  if (!parser) return null;

  const doc = parser.parseFromString(html, "text/html");

  return (
    <div className="font-mono text-[0.6rem] leading-relaxed">
      <DomNode node={doc.documentElement} depth={0} />
    </div>
  );
}

function DomNode({ node, depth }: { node: Element; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 3);
  const childElements = Array.from(node.children);
  const hasChildren = childElements.length > 0;
  const indent = depth * 12;

  const attrs = Array.from(node.attributes)
    .filter((a) => a.name !== "xmlns")
    .map((a) => (
      <span key={a.name}>
        {" "}
        <span style={{ color: "var(--ws-text-dim)" }}>{a.name}</span>
        <span style={{ color: "var(--ws-text-dim)" }}>=</span>
        <span style={{ color: "var(--ws-accent)" }}>&quot;{a.value.slice(0, 60)}{a.value.length > 60 ? "..." : ""}&quot;</span>
      </span>
    ));

  const textContent = !hasChildren && node.textContent?.trim()
    ? node.textContent.trim().slice(0, 80)
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
          <span style={{ color: "var(--ws-warning)" }}>{node.tagName.toLowerCase()}</span>
          {attrs}
          <span style={{ color: "var(--ws-text-muted)" }}>&gt;</span>
          {textContent && (
            <span style={{ color: "var(--ws-text)" }}>{textContent}</span>
          )}
          {!hasChildren && (
            <>
              <span style={{ color: "var(--ws-text-muted)" }}>&lt;/</span>
              <span style={{ color: "var(--ws-warning)" }}>{node.tagName.toLowerCase()}</span>
              <span style={{ color: "var(--ws-text-muted)" }}>&gt;</span>
            </>
          )}
        </span>
      </div>
      {expanded && childElements.map((child, i) => (
        <DomNode key={i} node={child} depth={depth + 1} />
      ))}
      {expanded && hasChildren && (
        <div style={{ paddingLeft: indent }}>
          <span className="ml-4">
            <span style={{ color: "var(--ws-text-muted)" }}>&lt;/</span>
            <span style={{ color: "var(--ws-warning)" }}>{node.tagName.toLowerCase()}</span>
            <span style={{ color: "var(--ws-text-muted)" }}>&gt;</span>
          </span>
        </div>
      )}
    </div>
  );
}
