"use client";

import { useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  SaveIcon,
} from "lucide-react";
import { FieldRenderer } from "@/components/fields";
import { CodeEditor } from "./code-editor";
import { updateExtractor } from "@/app/legacy/extractors/actions";
import type { FieldDefinition } from "@robot/config/parameters";
import { PARAMETER_DEFINITIONS, PARAMETER_GROUPS } from "@robot/config/parameters";
import { GOTO2_DEFINITIONS, GOTO2_GROUPS } from "@robot/config/goto2";

interface Extractor {
  id: string;
  orgId: string;
  domainId: string;
  country: string;
  variant: string;
  robotTemplate: string;
  parameters: unknown;
  isActive: boolean;
}

interface ConfigPanelProps {
  extractor: Extractor;
  orgs: { id: string; name: string }[];
  domains: { id: string; name: string }[];
  domainDefaults: Record<string, unknown>;
  jsOverrides: Record<string, string>;
  hasGoto2: boolean;
  hasBeforeExtract: boolean;
  hasExtract: boolean;
  hasTransform: boolean;
  credentials: { id: string; environment: string; username: string | null; createdAt: Date }[];
  sourceId?: string;
  onUpdateSource?: (data: { id: string; isActive?: boolean; parameters?: Record<string, unknown>; domainId?: string | null; country?: string; variant?: string; robotTemplate?: string }) => Promise<void>;
}

type TabId = "config" | "parameters" | "goto2" | "beforeExtract" | "credentials";

export function ConfigPanel({
  extractor,
  orgs,
  domains,
  domainDefaults,
  jsOverrides,
  hasGoto2,
  hasBeforeExtract,
  credentials,
  sourceId,
  onUpdateSource,
}: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("config");

  const tabs: { id: TabId; label: string; hidden?: boolean }[] = [
    { id: "config", label: "Config" },
    { id: "parameters", label: "Params" },
    { id: "goto2", label: "goto2", hidden: !hasGoto2 && !sourceId },
    { id: "beforeExtract", label: "beforeExtract", hidden: !hasBeforeExtract && !sourceId },
    { id: "credentials", label: "Creds" },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: 'var(--ws-panel-header)', borderBottom: '1px solid var(--ws-border)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ws-text)' }}>
          Configuration
        </span>
        <span className={`ws-badge ${extractor.isActive ? 'ws-badge-green' : 'ws-badge-red'}`}>
          {extractor.isActive ? 'active' : 'inactive'}
        </span>
      </div>

      {/* Tabs */}
      <div
        className="flex overflow-x-auto"
        style={{ borderBottom: '1px solid var(--ws-border)' }}
      >
        {tabs.filter((t) => !t.hidden).map((tab) => (
          <button
            key={tab.id}
            className="ws-tab"
            data-state={activeTab === tab.id ? "active" : "inactive"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "config" && (
          <ConfigTab extractor={extractor} orgs={orgs} domains={domains} sourceId={sourceId} onUpdateSource={onUpdateSource} />
        )}
        {activeTab === "parameters" && (
          <ParametersTab
            extractor={extractor}
            domainDefaults={domainDefaults}
            sourceId={sourceId}
            onUpdateSource={onUpdateSource}
          />
        )}
        {activeTab === "goto2" && (hasGoto2 || !!sourceId) && (
          <Goto2Tab
            extractor={extractor}
            domainDefaults={domainDefaults}
            sourceId={sourceId}
            onUpdateSource={onUpdateSource}
          />
        )}
        {activeTab === "beforeExtract" && (hasBeforeExtract || !!sourceId) && (
          <BeforeExtractTab
            code={jsOverrides.beforeExtract ?? ""}
          />
        )}
        {activeTab === "credentials" && (
          <CredentialsTab credentials={credentials} />
        )}
      </div>
    </div>
  );
}

/* ── Config Tab ─────────────────────────────────────────── */

function ConfigTab({
  extractor,
  orgs,
  domains,
  sourceId,
  onUpdateSource,
}: {
  extractor: ConfigPanelProps["extractor"];
  orgs: ConfigPanelProps["orgs"];
  domains: ConfigPanelProps["domains"];
  sourceId?: string;
  onUpdateSource?: ConfigPanelProps["onUpdateSource"];
}) {
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    const form = new FormData(e.currentTarget);

    if (sourceId && onUpdateSource) {
      // Source-based update
      const currentParams = (extractor.parameters as Record<string, unknown>) ?? {};
      const useTransform = form.get("useTransform") === "on";
      await onUpdateSource({
        id: sourceId,
        isActive: form.get("isActive") === "on",
        parameters: { ...currentParams, useTransform },
        domainId: (form.get("domainId") as string) || null,
        country: form.get("country") as string,
        variant: form.get("variant") as string,
        robotTemplate: form.get("robotTemplate") as string,
      });
    } else {
      // Legacy extractor update
      await updateExtractor(form);
    }
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input type="hidden" name="id" value={extractor.id} />
      <input type="hidden" name="parameters" value={JSON.stringify(extractor.parameters ?? {})} />

      <SectionHeader title="Identity" />
      <div className="space-y-0">
        <div className="ws-field-row">
          <label className="ws-field-label">Organization</label>
          <select name="orgId" defaultValue={extractor.orgId} className="w-full rounded px-2 py-1">
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </div>
        <div className="ws-field-row">
          <label className="ws-field-label">Domain</label>
          <select name="domainId" defaultValue={extractor.domainId} className="w-full rounded px-2 py-1">
            {domains.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="ws-field-row">
          <label className="ws-field-label">Country</label>
          <input name="country" defaultValue={extractor.country} className="w-full rounded px-2 py-1" placeholder="US" />
        </div>
        <div className="ws-field-row">
          <label className="ws-field-label">Variant</label>
          <input name="variant" defaultValue={extractor.variant} className="w-full rounded px-2 py-1" placeholder="default" />
        </div>
      </div>

      <SectionHeader title="Runtime" />
      <div className="space-y-0">
        <div className="ws-field-row">
          <label className="ws-field-label">Robot Template</label>
          <input name="robotTemplate" defaultValue={extractor.robotTemplate} className="w-full rounded px-2 py-1" />
        </div>
        <ToggleField name="isActive" label="Active" defaultChecked={extractor.isActive} />
        <ToggleField name="useTransform" label="Use Transform" defaultChecked={Boolean((extractor.parameters as Record<string, unknown>)?.useTransform)} hint="cleanUp via transform.js" />
      </div>

      <div className="px-3 py-3">
        <button
          type="submit"
          disabled={saving}
          className="w-full rounded py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors"
          style={{
            background: saving ? 'var(--ws-surface-hover)' : 'var(--ws-accent)',
            color: saving ? 'var(--ws-text-muted)' : '#fff',
          }}
        >
          <span className="flex items-center justify-center gap-1.5">
            <SaveIcon className="size-3" />
            {saving ? "Saving..." : "Update Config"}
          </span>
        </button>
      </div>
    </form>
  );
}

/* ── Parameters Tab ─────────────────────────────────────── */

function ParametersTab({
  extractor,
  domainDefaults,
  sourceId,
  onUpdateSource,
}: {
  extractor: ConfigPanelProps["extractor"];
  domainDefaults: Record<string, unknown>;
  sourceId?: string;
  onUpdateSource?: ConfigPanelProps["onUpdateSource"];
}) {
  const [overrides, setOverrides] = useState<Record<string, unknown>>(
    (extractor.parameters as Record<string, unknown>) ?? {}
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = (name: string, value: unknown) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value === undefined) {
        delete next[name];
      } else {
        next[name] = value;
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    if (sourceId && onUpdateSource) {
      await onUpdateSource({ id: sourceId, parameters: overrides });
    } else {
      const form = new FormData();
      form.set("id", extractor.id);
      form.set("orgId", extractor.orgId);
      form.set("domainId", extractor.domainId);
      form.set("country", extractor.country);
      form.set("variant", extractor.variant);
      form.set("robotTemplate", extractor.robotTemplate);
      if (extractor.isActive) form.set("isActive", "on");
      form.set("parameters", JSON.stringify(overrides));
      await updateExtractor(form);
    }
    setSaving(false);
  };

  const renderField = (def: FieldDefinition) => {
    if (def.ignore) return null;
    if (def.hide && !showAdvanced) return null;
    if (def.advanced && !showAdvanced) return null;

    return (
      <FieldRenderer
        key={def.name}
        definition={def}
        value={overrides[def.name]}
        defaultValue={domainDefaults[def.name] ?? def.default}
        onChange={(v) => handleChange(def.name, v)}
      />
    );
  };

  return (
    <div>
      {Object.entries(PARAMETER_GROUPS).map(([groupName, paramNames]) => {
        const groupDefs = paramNames
          .map((n) => PARAMETER_DEFINITIONS.find((d) => d.name === n))
          .filter((d): d is FieldDefinition => d != null);

        const visibleDefs = groupDefs.filter(
          (d) => !d.ignore && (showAdvanced || (!d.advanced && !d.hide))
        );
        if (visibleDefs.length === 0) return null;

        return (
          <CollapsibleGroup key={groupName} title={groupName}>
            <div className="space-y-0 py-1">
              {groupDefs.map(renderField)}
            </div>
          </CollapsibleGroup>
        );
      })}

      <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: '1px solid var(--ws-border-subtle)' }}>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[0.65rem] transition-colors"
          style={{ color: 'var(--ws-accent)' }}
        >
          {showAdvanced ? "Hide advanced" : "Show advanced"}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors"
          style={{
            background: saving ? 'var(--ws-surface-hover)' : 'var(--ws-accent)',
            color: saving ? 'var(--ws-text-muted)' : '#fff',
          }}
        >
          {saving ? "Saving..." : "Save Parameters"}
        </button>
      </div>
    </div>
  );
}

/* ── goto2 Tab ─────────────────────────────────────────── */

function Goto2Tab({
  extractor,
  domainDefaults,
  sourceId,
  onUpdateSource,
}: {
  extractor: ConfigPanelProps["extractor"];
  domainDefaults: Record<string, unknown>;
  sourceId?: string;
  onUpdateSource?: ConfigPanelProps["onUpdateSource"];
}) {
  const params = (extractor.parameters as Record<string, unknown>) ?? {};
  const goto2Overrides = (params.goto2 as Record<string, unknown>) ?? {};
  const [goto2State, setGoto2State] = useState<Record<string, unknown>>(goto2Overrides);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = (name: string, value: unknown) => {
    setGoto2State((prev) => {
      const next = { ...prev };
      if (value === undefined) {
        delete next[name];
      } else {
        next[name] = value;
      }
      return next;
    });
  };

  const goto2Defaults = (domainDefaults.goto2 as Record<string, unknown>) ?? {};

  const handleSave = async () => {
    setSaving(true);
    const mergedParams = { ...params, goto2: goto2State };
    if (sourceId && onUpdateSource) {
      await onUpdateSource({ id: sourceId, parameters: mergedParams });
    } else {
      const form = new FormData();
      form.set("id", extractor.id);
      form.set("orgId", extractor.orgId);
      form.set("domainId", extractor.domainId);
      form.set("country", extractor.country);
      form.set("variant", extractor.variant);
      form.set("robotTemplate", extractor.robotTemplate);
      if (extractor.isActive) form.set("isActive", "on");
      form.set("parameters", JSON.stringify(mergedParams));
      await updateExtractor(form);
    }
    setSaving(false);
  };

  const renderField = (def: FieldDefinition) => {
    if (def.ignore) return null;
    if (def.hide && !showAdvanced) return null;
    if (def.advanced && !showAdvanced) return null;

    return (
      <FieldRenderer
        key={def.name}
        definition={def}
        value={goto2State[def.name]}
        defaultValue={goto2Defaults[def.name] ?? def.default}
        onChange={(v) => handleChange(def.name, v)}
      />
    );
  };

  return (
    <div>
      {Object.entries(GOTO2_GROUPS).map(([groupName, paramNames]) => {
        const groupDefs = paramNames
          .map((n) => GOTO2_DEFINITIONS.find((d) => d.name === n))
          .filter((d): d is FieldDefinition => d != null);

        const visibleDefs = groupDefs.filter(
          (d) => !d.ignore && (showAdvanced || (!d.advanced && !d.hide))
        );
        if (visibleDefs.length === 0) return null;

        return (
          <CollapsibleGroup key={groupName} title={groupName}>
            <div className="space-y-0 py-1">
              {groupDefs.map(renderField)}
            </div>
          </CollapsibleGroup>
        );
      })}
      <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: '1px solid var(--ws-border-subtle)' }}>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[0.65rem] transition-colors"
          style={{ color: 'var(--ws-accent)' }}
        >
          {showAdvanced ? "Hide advanced" : "Show advanced"}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors"
          style={{
            background: saving ? 'var(--ws-surface-hover)' : 'var(--ws-accent)',
            color: saving ? 'var(--ws-text-muted)' : '#fff',
          }}
        >
          {saving ? "Saving..." : "Save goto2"}
        </button>
      </div>
    </div>
  );
}

/* ── beforeExtract Tab ─────────────────────────────────── */

const BEFORE_EXTRACT_DEFAULT = `/**
 * beforeExtract — runs after page load, before data extraction.
 * Use this to dismiss popups, expand sections, set filters, etc.
 *
 * @param {object} context - Playwright page context (goto, click, waitForSelector, etc.)
 * @param {object} inputs  - Input data for this run (_url, custom fields)
 * @param {object} params  - Extractor parameters
 */
export default async function beforeExtract(context, inputs, params) {
  // Example: close cookie banner
  // await context.click('[data-testid="cookie-accept"]', { timeout: 3000 }).catch(() => {});
}
`;

function BeforeExtractTab({ code }: { code: string }) {
  const [value, setValue] = useState(code || BEFORE_EXTRACT_DEFAULT);

  return (
    <div className="flex h-full flex-col">
      <SectionHeader title="beforeExtract.js" />
      <div className="flex-1 min-h-0">
        <CodeEditor
          value={value}
          onChange={setValue}
          maxHeight={9999}
        />
      </div>
    </div>
  );
}

/* ── Credentials Tab ────────────────────────────────────── */

function CredentialsTab({
  credentials,
}: {
  credentials: ConfigPanelProps["credentials"];
}) {
  if (credentials.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center">
        <span className="text-xs" style={{ color: 'var(--ws-text-dim)' }}>No credentials configured</span>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Credentials" />
      <div>
        {credentials.map((cred) => (
          <div key={cred.id} className="ws-field-row">
            <span className="ws-field-label">{cred.environment}</span>
            <span className="truncate text-xs" style={{ color: 'var(--ws-text)' }}>{cred.username}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Shared Helpers ─────────────────────────────────────── */

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="ws-group-header" style={{ cursor: 'default' }}>
      {title}
    </div>
  );
}

function ToggleField({
  name,
  label,
  defaultChecked,
  hint,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
  hint?: string;
}) {
  const [checked, setChecked] = useState(defaultChecked);

  return (
    <div className="ws-field-row">
      <label className="ws-field-label">{label}</label>
      <div className="flex items-center py-1">
        <input type="hidden" name={name} value={checked ? "on" : ""} />
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => setChecked((v) => !v)}
          className="relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors"
          style={{ background: checked ? 'var(--ws-accent)' : 'var(--ws-surface-hover)' }}
        >
          <span
            className="absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform"
            style={{ transform: checked ? 'translateX(0.75rem)' : 'translateX(0)' }}
          />
        </button>
        {hint && <span className="ml-2 text-[0.6rem]" style={{ color: 'var(--ws-text-dim)' }}>{hint}</span>}
      </div>
    </div>
  );
}

function CollapsibleGroup({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: '1px solid var(--ws-border-subtle)' }}>
      <button
        type="button"
        className="ws-group-header w-full"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDownIcon className="size-3" />
        ) : (
          <ChevronRightIcon className="size-3" />
        )}
        {title}
      </button>
      {open && children}
    </div>
  );
}
