"use client";

import { useState, useMemo, useRef, useEffect } from "react";

interface Domain {
  id: string;
  name: string;
}

interface DomainPickerProps {
  domains: Domain[];
  value: string;
  onChange: (domainId: string) => void;
  onCreateNew: (name: string) => Promise<void>;
  creating: boolean;
}

export function DomainPicker({ domains, value, onChange, onCreateNew, creating }: DomainPickerProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = useMemo(() => {
    if (!search) return domains;
    const q = search.toLowerCase();
    return domains.filter((d) => d.name.toLowerCase().includes(q));
  }, [domains, search]);

  const selectedName = domains.find((d) => d.id === value)?.name ?? "";
  const showCreateOption = search.trim() && !domains.some((d) => d.name.toLowerCase() === search.trim().toLowerCase());

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        value={open ? search : selectedName}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setSearch(""); }}
        placeholder="Search domains..."
        className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
        style={{
          background: "var(--ws-surface)",
          border: "1px solid var(--ws-border)",
          color: "var(--ws-text)",
        }}
      />

      {open && (
        <div
          className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded shadow-lg"
          style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)" }}
        >
          {filtered.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => { onChange(d.id); setSearch(""); setOpen(false); }}
              className="block w-full px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--ws-surface-hover)]"
              style={{ color: d.id === value ? "var(--ws-accent)" : "var(--ws-text)" }}
            >
              {d.name}
            </button>
          ))}

          {showCreateOption && (
            <button
              type="button"
              onClick={async () => {
                await onCreateNew(search.trim());
                setSearch("");
                setOpen(false);
              }}
              disabled={creating}
              className="block w-full px-2.5 py-1.5 text-left text-xs font-medium transition-colors hover:bg-[var(--ws-surface-hover)]"
              style={{ color: "var(--ws-accent)" }}
            >
              {creating ? "Creating..." : `+ Create "${search.trim()}"`}
            </button>
          )}

          {filtered.length === 0 && !showCreateOption && (
            <div className="px-2.5 py-1.5 text-xs" style={{ color: "var(--ws-text-dim)" }}>
              No domains found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
