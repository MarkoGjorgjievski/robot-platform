"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDownIcon } from "lucide-react";

interface Option {
  value: string;
  label: string;
}

interface SearchSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = search
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          o.value.toLowerCase().includes(search.toLowerCase()),
      )
    : options;

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-xs text-left disabled:opacity-40"
        style={{
          background: "var(--ws-surface)",
          border: "1px solid var(--ws-border)",
          color: selected ? "var(--ws-text)" : "var(--ws-text-dim)",
        }}
      >
        <span className="truncate">
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDownIcon className="size-3 shrink-0 ml-1" style={{ color: "var(--ws-text-dim)" }} />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded shadow-lg"
          style={{
            background: "var(--ws-surface-raised)",
            border: "1px solid var(--ws-border)",
            maxHeight: 200,
          }}
        >
          <div className="p-1.5" style={{ borderBottom: "1px solid var(--ws-border-subtle)" }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full rounded px-2 py-1 text-xs outline-none"
              style={{
                background: "var(--ws-surface)",
                color: "var(--ws-text)",
              }}
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 156 }}>
            {filtered.length === 0 && (
              <div className="px-2.5 py-2 text-xs" style={{ color: "var(--ws-text-dim)" }}>
                No results
              </div>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                  setSearch("");
                }}
                className="flex w-full items-center px-2.5 py-1.5 text-xs text-left transition-colors hover:bg-[var(--ws-surface-hover)]"
                style={{
                  color: o.value === value ? "var(--ws-accent)" : "var(--ws-text)",
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
