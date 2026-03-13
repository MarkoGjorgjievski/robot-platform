"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SearchSelect } from "./search-select";
import { PencilIcon, XIcon, SaveIcon } from "lucide-react";
import { COUNTRIES, LANGUAGES, CURRENCIES, DATA_CENTERS, PROXY_TYPES, LOGIN_POOLS, DOMAIN_OPTIONS } from "@/lib/constants";

interface SourceData {
  id: string;
  name: string;
  slug: string;
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

interface SourceFormProps {
  mode: "create" | "view";
  source?: SourceData;
  existingSlugs: string[];
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
  onClose: () => void;
}

function toChain(name: string, country: string): string {
  const snake = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${snake}_${country.toLowerCase()}`;
}

const countryOptions = COUNTRIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }));
const localeOptions = LANGUAGES.map((l) => ({ value: l.code, label: `${l.code} — ${l.name}` }));
const currencyOptions = CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }));
const domainOptions = DOMAIN_OPTIONS.map((d) => ({ value: d, label: d }));
const dataCenterOptions = DATA_CENTERS.map((dc) => ({ value: dc, label: dc }));
const proxyTypeOptions = PROXY_TYPES.map((pt) => ({ value: pt, label: pt }));
const loginPoolOptions = LOGIN_POOLS.map((lp) => ({ value: lp, label: lp }));

export function SourceForm({
  mode: initialMode,
  source,
  existingSlugs,
  collectionId,
  onSubmit,
  onClose,
}: SourceFormProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(initialMode === "create");

  const [name, setName] = useState(source?.name ?? "");
  const [country, setCountry] = useState(source?.country ?? "");
  const [locale, setLocale] = useState(source?.locale ?? "");
  const [currency, setCurrency] = useState(source?.currency ?? "");
  const [domain, setDomain] = useState(source?.domain ?? "");
  const [dataCenter, setDataCenter] = useState(source?.dataCenter ?? "");
  const [proxyType, setProxyType] = useState(source?.proxyType ?? "");
  const [loginPool, setLoginPool] = useState(source?.loginPool ?? "");
  const [maximumInputs, setMaximumInputs] = useState(source?.maximumInputs?.toString() ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const chain = useMemo(() => (name && country ? toChain(name, country) : ""), [name, country]);
  const slug = chain;

  const validate = (): string => {
    if (name.trim().length < 2) return "Name must be at least 2 characters.";
    if (!country) return "Country is required.";
    if (slug && existingSlugs.includes(slug) && initialMode === "create") return "Source with this slug already exists.";
    return "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        collectionId,
        name: name.trim(),
        slug,
        country,
        locale: locale || null,
        currency: currency || null,
        domain: domain || null,
        dataCenter: dataCenter || null,
        proxyType: proxyType || null,
        loginPool: loginPool || null,
        maximumInputs: maximumInputs ? parseInt(maximumInputs, 10) : null,
      });
      router.refresh();
      if (initialMode === "create") onClose();
    } catch {
      setError("Failed to create source.");
    } finally {
      setSubmitting(false);
    }
  };

  const isView = initialMode === "view" && !editing;

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ background: "var(--ws-bg)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--ws-border-subtle)" }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ws-text-muted)" }}>
          {initialMode === "create" ? "New Source" : source?.name}
        </h2>
        <div className="flex items-center gap-1">
          {initialMode === "view" && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded p-1 transition-colors hover:bg-[var(--ws-surface-hover)]"
              title="Edit"
            >
              <PencilIcon className="size-3" style={{ color: "var(--ws-text-muted)" }} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 transition-colors hover:bg-[var(--ws-surface-hover)]"
            title="Close"
          >
            <XIcon className="size-3" style={{ color: "var(--ws-text-muted)" }} />
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-5">
        {/* Section: Identity */}
        <fieldset>
          <legend className="text-[0.6rem] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--ws-text-dim)" }}>
            Identity
          </legend>
          <div className="space-y-3">
            <Field label="Name">
              {isView ? (
                <ReadOnly value={name} />
              ) : (
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Best Buy"
                  className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
                  style={{
                    background: "var(--ws-surface)",
                    border: "1px solid var(--ws-border)",
                    color: "var(--ws-text)",
                  }}
                />
              )}
            </Field>

            <Field label="Country">
              {isView ? (
                <ReadOnly value={country} />
              ) : (
                <SearchSelect options={countryOptions} value={country} onChange={setCountry} placeholder="Select country..." />
              )}
            </Field>

            <Field label="Locale">
              {isView ? (
                <ReadOnly value={locale || "—"} />
              ) : (
                <SearchSelect options={localeOptions} value={locale} onChange={setLocale} placeholder="Select locale..." />
              )}
            </Field>

            <Field label="Currency">
              {isView ? (
                <ReadOnly value={currency || "—"} />
              ) : (
                <SearchSelect options={currencyOptions} value={currency} onChange={setCurrency} placeholder="Select currency..." />
              )}
            </Field>

            <Field label="Domain">
              {isView ? (
                <ReadOnly value={domain || "—"} />
              ) : (
                <SearchSelect options={domainOptions} value={domain} onChange={setDomain} placeholder="Select domain..." />
              )}
            </Field>

            <Field label="Chain">
              <ReadOnly value={chain || "—"} />
            </Field>

            <Field label="Slug">
              <ReadOnly value={slug || "—"} />
            </Field>
          </div>
        </fieldset>

        {/* Section: Infrastructure */}
        <fieldset>
          <legend className="text-[0.6rem] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--ws-text-dim)" }}>
            Infrastructure
          </legend>
          <div className="space-y-3">
            <Field label="Data Center">
              {isView ? (
                <ReadOnly value={dataCenter || "—"} />
              ) : (
                <SearchSelect options={dataCenterOptions} value={dataCenter} onChange={setDataCenter} placeholder="Select data center..." />
              )}
            </Field>

            <Field label="Proxy Type">
              {isView ? (
                <ReadOnly value={proxyType || "—"} />
              ) : (
                <SearchSelect options={proxyTypeOptions} value={proxyType} onChange={setProxyType} placeholder="Select proxy type..." />
              )}
            </Field>

            <Field label="Login Pool">
              {isView ? (
                <ReadOnly value={loginPool || "—"} />
              ) : (
                <SearchSelect options={loginPoolOptions} value={loginPool} onChange={setLoginPool} placeholder="Select login pool..." />
              )}
            </Field>

            <Field label="Maximum Inputs">
              {isView ? (
                <ReadOnly value={maximumInputs || "—"} />
              ) : (
                <input
                  type="number"
                  value={maximumInputs}
                  onChange={(e) => setMaximumInputs(e.target.value)}
                  placeholder="e.g. 100"
                  min={1}
                  className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
                  style={{
                    background: "var(--ws-surface)",
                    border: "1px solid var(--ws-border)",
                    color: "var(--ws-text)",
                  }}
                />
              )}
            </Field>
          </div>
        </fieldset>

        {/* Error */}
        {error && (
          <p className="text-xs" style={{ color: "var(--ws-danger)" }}>{error}</p>
        )}

        {/* Actions */}
        {editing && (
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-40"
              style={{ background: "var(--ws-accent)", color: "#fff" }}
            >
              <SaveIcon className="size-3" />
              {submitting ? "Saving..." : initialMode === "create" ? "Create" : "Save"}
            </button>
            {initialMode === "view" && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded px-3 py-1.5 text-xs transition-colors"
                style={{ color: "var(--ws-text-muted)" }}
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[0.6rem] font-medium uppercase tracking-wider" style={{ color: "var(--ws-text-muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ReadOnly({ value }: { value: string }) {
  return (
    <div
      className="rounded px-2.5 py-1.5 text-xs"
      style={{
        background: "var(--ws-surface)",
        border: "1px solid var(--ws-border-subtle)",
        color: "var(--ws-text-dim)",
      }}
    >
      {value}
    </div>
  );
}
