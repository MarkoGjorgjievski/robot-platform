"use client";

import { useRef, useEffect, useCallback } from "react";
import { CodeJar } from "codejar";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  language?: string;
  maxHeight?: number;
}

function highlight(editor: HTMLElement) {
  const code = editor.textContent ?? "";
  editor.innerHTML = Prism.highlight(code, Prism.languages.javascript, "javascript");
}

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  maxHeight = 400,
}: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const jarRef = useRef<ReturnType<typeof CodeJar> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const jar = CodeJar(el, highlight, {
      tab: "  ",
      indentOn: /[{(]\s*$/,
    });

    jar.updateCode(value);

    jar.onUpdate((code) => {
      onChangeRef.current?.(code);
    });

    jarRef.current = jar;

    return () => {
      jar.destroy();
      jarRef.current = null;
    };
    // Only create jar once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes (only if it differs from current jar content)
  useEffect(() => {
    const jar = jarRef.current;
    if (!jar) return;
    const el = editorRef.current;
    if (!el) return;
    const current = el.textContent ?? "";
    if (current !== value) {
      jar.updateCode(value);
    }
  }, [value]);

  return (
    <div
      className="code-editor-wrapper"
      style={{
        maxHeight,
        overflow: "auto",
        background: "var(--ws-bg)",
        borderRadius: 4,
        border: readOnly ? undefined : "1px solid var(--ws-border)",
      }}
    >
      <div
        ref={editorRef}
        className="code-editor"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        style={{
          fontFamily: "inherit",
          fontSize: "0.68rem",
          lineHeight: 1.6,
          padding: "12px",
          color: "var(--ws-text)",
          outline: "none",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          minHeight: 60,
          caretColor: readOnly ? "transparent" : "var(--ws-accent)",
        }}
      />
    </div>
  );
}
