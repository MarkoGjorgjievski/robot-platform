"use client";

import { useState } from "react";
import Link from "next/link";
import { PlusIcon, ClockIcon, ArrowRightIcon, GlobeIcon, ServerIcon } from "lucide-react";
import { SourceForm } from "@/components/source-form";

interface SourceItem {
  id: string;
  name: string;
  slug: string;
  href: string;
  country: string;
  locale: string | null;
  currency: string | null;
  domain: string | null;
  dataCenter: string | null;
  proxyType: string | null;
  loginPool: string | null;
  maximumInputs: number | null;
  isActive: boolean;
  updatedAt: Date;
}

interface SourcesLayoutProps {
  items: SourceItem[];
  collectionId: string;
  onSubmit: (data: {
    collectionId: string;
    name: string;
    slug: string;
    country: string;
    locale?: string | null;
    currency?: string | null;
    domain?: string | null;
    dataCenter?: string | null;
    proxyType?: string | null;
    loginPool?: string | null;
    maximumInputs?: number | null;
  }) => Promise<{ slug: string }>;
}

export function SourcesLayout({
  items,
  collectionId,
  onSubmit,
}: SourcesLayoutProps) {
  const [panel, setPanel] = useState<{ mode: "create" } | { mode: "view"; slug: string } | null>(null);

  const selectedSource = panel?.mode === "view"
    ? items.find((s) => s.slug === panel.slug) ?? null
    : null;

  // Group items by first letter
  const grouped = new Map<string, SourceItem[]>();
  for (const item of [...items].sort((a, b) => a.name.localeCompare(b.name))) {
    const letter = item.name[0]?.toUpperCase() ?? "#";
    if (!grouped.has(letter)) grouped.set(letter, []);
    grouped.get(letter)!.push(item);
  }

  // Recent: sorted by updatedAt desc, take 10
  const recent = [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 10);

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 12rem)" }}>
      {/* Left: Recent */}
      <div
        className="w-56 shrink-0 overflow-y-auto rounded-lg"
        style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)" }}
      >
        <div
          className="px-3 py-2.5"
          style={{ borderBottom: "1px solid var(--ws-border-subtle)" }}
        >
          <div className="flex items-center gap-1.5">
            <ClockIcon className="size-3" style={{ color: "var(--ws-text-dim)" }} />
            <span className="text-[0.6rem] font-bold uppercase tracking-widest" style={{ color: "var(--ws-text-muted)" }}>
              Recent
            </span>
          </div>
        </div>
        {recent.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <span className="text-[0.6rem]" style={{ color: "var(--ws-text-dim)" }}>No recent sources</span>
          </div>
        ) : (
          <div className="py-1">
            {recent.map((s) => (
              <button
                key={s.slug}
                type="button"
                onClick={() => setPanel({ mode: "view", slug: s.slug })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--ws-surface-hover)]"
              >
                <div
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: s.isActive ? "var(--ws-success)" : "var(--ws-text-dim)" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.65rem] font-medium" style={{ color: "var(--ws-text)" }}>
                    {s.name}
                  </p>
                  <p className="text-[0.5rem]" style={{ color: "var(--ws-text-dim)" }}>
                    {s.country}{s.domain ? ` · ${s.domain}` : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Middle: Source cards */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {/* New Source button */}
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setPanel({ mode: "create" })}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors"
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
                  const isSelected = panel?.mode === "view" && panel.slug === item.slug;
                  return (
                    <div
                      key={item.slug}
                      className="group cursor-pointer rounded-lg p-3 transition-colors"
                      onClick={() => setPanel({ mode: "view", slug: item.slug })}
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
                        {item.domain && (
                          <Detail icon={<ServerIcon className="size-2.5" />} label={item.domain} />
                        )}
                        {item.locale && (
                          <Detail label={item.locale} dimmed />
                        )}
                        {item.currency && (
                          <Detail label={item.currency} dimmed />
                        )}
                        {item.dataCenter && (
                          <Detail label={`DC: ${item.dataCenter}`} dimmed />
                        )}
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

      {/* Right: Create / View panel — always reserving space */}
      <div
        className="w-80 shrink-0 rounded-lg overflow-hidden"
        style={{
          background: panel ? "var(--ws-surface)" : "transparent",
          border: panel ? "1px solid var(--ws-border)" : "1px solid transparent",
        }}
      >
        {panel?.mode === "create" ? (
          <SourceForm
            mode="create"
            existingSlugs={items.map((s) => s.slug)}
            collectionId={collectionId}
            onSubmit={onSubmit}
            onClose={() => setPanel(null)}
          />
        ) : panel?.mode === "view" && selectedSource ? (
          <SourceForm
            key={selectedSource.slug}
            mode="view"
            source={selectedSource}
            existingSlugs={items.filter((s) => s.slug !== selectedSource.slug).map((s) => s.slug)}
            collectionId={collectionId}
            onSubmit={onSubmit}
            onClose={() => setPanel(null)}
          />
        ) : null}
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
