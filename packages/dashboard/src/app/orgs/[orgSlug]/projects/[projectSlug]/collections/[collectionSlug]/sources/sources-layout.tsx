"use client";

import Link from "next/link";
import { ArrowRightIcon, GlobeIcon, ServerIcon, PlusIcon } from "lucide-react";
import { useCollectionContext } from "../collection-context";

interface SourceItem {
  id: string;
  name: string;
  slug: string;
  href: string;
  country: string;
  locale: string | null;
  currency: string | null;
  runnerFramework: string | null;
  dataCenter: string | null;
  proxyType: string | null;
  loginPool: string | null;
  maximumInputs: number | null;
  isActive: boolean;
  updatedAt: Date;
}

interface SourcesLayoutProps {
  items: SourceItem[];
}

export function SourcesLayout({ items }: SourcesLayoutProps) {
  const { selectedSlug, selectSource, createSource } = useCollectionContext();

  // Group items by first letter
  const grouped = new Map<string, SourceItem[]>();
  for (const item of [...items].sort((a, b) => a.name.localeCompare(b.name))) {
    const letter = item.name[0]?.toUpperCase() ?? "#";
    if (!grouped.has(letter)) grouped.set(letter, []);
    grouped.get(letter)!.push(item);
  }

  return (
    <div>
      {/* New Source */}
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={createSource}
          className="flex items-center gap-1.5 rounded px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wider transition-colors"
          style={{ background: "var(--ws-accent)", color: "#fff" }}
        >
          <PlusIcon className="size-3" />
          New Source
        </button>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div
          className="flex items-center justify-center rounded-lg py-20"
          style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)" }}
        >
          <span className="text-xs" style={{ color: "var(--ws-text-dim)" }}>
            No sources yet. Create one to get started.
          </span>
        </div>
      )}

      {/* Grouped cards */}
      <div className="space-y-5">
        {[...grouped.entries()].map(([letter, letterItems]) => (
          <div key={letter}>
            <div className="mb-2 flex items-center gap-2" style={{ borderBottom: "1px solid var(--ws-border-subtle)" }}>
              <span className="pb-1.5 text-xs font-bold uppercase tracking-widest" style={{ color: "var(--ws-text-muted)" }}>
                {letter}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {letterItems.map((item) => {
                const isSelected = selectedSlug === item.slug;
                return (
                  <div
                    key={item.slug}
                    className="group cursor-pointer rounded-lg p-3 transition-colors"
                    onClick={() => selectSource(item.slug)}
                    style={{
                      background: isSelected ? "var(--ws-accent-surface)" : "var(--ws-surface)",
                      border: `1px solid ${isSelected ? "var(--ws-accent-muted)" : "var(--ws-border)"}`,
                    }}
                  >
                    {/* Card header */}
                    <div className="mb-2 flex items-start justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: item.isActive ? "var(--ws-success)" : "var(--ws-text-dim)" }}
                          />
                          <p className="truncate text-xs font-semibold" style={{ color: "var(--ws-text)" }} title={item.name}>
                            {item.name}
                          </p>
                        </div>
                      </div>
                      <Link
                        href={item.href}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 rounded p-1 opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--ws-surface-hover)]"
                        title="Open workspace"
                      >
                        <ArrowRightIcon className="size-3" style={{ color: "var(--ws-accent)" }} />
                      </Link>
                    </div>

                    {/* Card details */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <Detail icon={<GlobeIcon className="size-2.5" />} label={item.country} />
                      {item.runnerFramework && (
                        <Detail icon={<ServerIcon className="size-2.5" />} label={item.runnerFramework} />
                      )}
                      {item.locale && <Detail label={item.locale} dimmed />}
                      {item.currency && <Detail label={item.currency} dimmed />}
                      {item.dataCenter && <Detail label={`DC: ${item.dataCenter}`} dimmed />}
                    </div>

                    {/* Slug */}
                    <p className="mt-2 truncate text-[0.55rem] font-mono" style={{ color: "var(--ws-text-dim)" }}>
                      {item.slug}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Detail({ icon, label, dimmed }: { icon?: React.ReactNode; label: string; dimmed?: boolean }) {
  return (
    <span
      className="flex items-center gap-1 text-[0.6rem]"
      style={{ color: dimmed ? "var(--ws-text-dim)" : "var(--ws-text-muted)" }}
    >
      {icon}
      {label}
    </span>
  );
}
