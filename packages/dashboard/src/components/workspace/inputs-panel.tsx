"use client";

import { useState, useCallback } from "react";
import { PlayIcon, PencilIcon, PlusIcon, XIcon, SaveIcon, TrashIcon } from "lucide-react";

interface InputEntry {
  id: string;
  label: string;
  inputData: Record<string, unknown>;
  createdAt: Date;
}

interface InputsPanelProps {
  inputs: InputEntry[];
  sourceId: string;
  onSave: (sourceId: string, label: string, inputData: Record<string, unknown>) => Promise<unknown>;
  onUpdate: (id: string, label: string, inputData: Record<string, unknown>) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onRun: (sourceId: string, inputLabel: string) => Promise<unknown>;
}

type PanelMode =
  | { type: "list" }
  | { type: "create"; keys: string[]; values: Record<string, string> }
  | { type: "edit"; inputId: string; values: Record<string, string>; original: Record<string, string> };

export function InputsPanel({ inputs, sourceId, onSave, onUpdate, onDelete, onRun }: InputsPanelProps) {
  const [mode, setMode] = useState<PanelMode>({ type: "list" });
  const [runningLabel, setRunningLabel] = useState<string | null>(null);

  const templateKeys = inputs.length > 0
    ? Object.keys((inputs[0].inputData ?? {}) as Record<string, unknown>)
    : [];

  const handleAddInput = useCallback(() => {
    if (inputs.length === 0) {
      setMode({ type: "create", keys: [""], values: {} });
    } else {
      const emptyValues: Record<string, string> = {};
      for (const key of templateKeys) emptyValues[key] = "";
      setMode({ type: "create", keys: templateKeys, values: emptyValues });
    }
  }, [inputs.length, templateKeys]);

  const handleEdit = useCallback((input: InputEntry) => {
    const data = (input.inputData ?? {}) as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) values[k] = String(v ?? "");
    setMode({ type: "edit", inputId: input.id, values, original: { ...values } });
  }, []);

  const handleSaveNew = useCallback(async (keys: string[], values: Record<string, string>) => {
    const inputData: Record<string, unknown> = {};
    for (const key of keys) {
      if (key.trim()) inputData[key.trim()] = values[key] ?? "";
    }
    const label = `input-${inputs.length + 1}`;
    await onSave(sourceId, label, inputData);
    setMode({ type: "list" });
  }, [inputs.length, onSave, sourceId]);

  const handleSaveEdit = useCallback(async (inputId: string, values: Record<string, string>) => {
    const input = inputs.find((i) => i.id === inputId);
    if (!input) return;
    const inputData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) inputData[k] = v;
    await onUpdate(inputId, input.label, inputData);
    setMode({ type: "list" });
  }, [inputs, onUpdate]);

  const handleRun = useCallback(async (label: string) => {
    setRunningLabel(label);
    try {
      await onRun(sourceId, label);
    } finally {
      setRunningLabel(null);
    }
  }, [onRun, sourceId]);

  const isDirty = mode.type === "edit"
    ? JSON.stringify(mode.values) !== JSON.stringify(mode.original)
    : false;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="ws-group-header" style={{ cursor: "default" }}>
        Inputs
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[0.55rem] opacity-60">{inputs.length}</span>
          {mode.type === "list" && (
            <button
              onClick={handleAddInput}
              className="flex items-center gap-0.5 text-[0.6rem] transition-colors hover:opacity-80"
              style={{ color: "var(--ws-accent)" }}
            >
              <PlusIcon className="size-3" />
              Add
            </button>
          )}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {mode.type === "list" && inputs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3">
            <span className="text-[0.65rem]" style={{ color: "var(--ws-text-dim)" }}>
              No inputs yet
            </span>
            <button
              onClick={handleAddInput}
              className="flex items-center gap-1 rounded px-2 py-1 text-[0.6rem] transition-colors"
              style={{ color: "var(--ws-accent)", background: "var(--ws-accent-surface)" }}
            >
              <PlusIcon className="size-3" />
              Add first input
            </button>
          </div>
        )}

        {mode.type === "list" && inputs.map((input) => {
          const data = (input.inputData ?? {}) as Record<string, unknown>;
          const preview = Object.entries(data).map(([k, v]) => `${k}: ${String(v)}`).join("  ");
          const isRunning = runningLabel === input.label;

          return (
            <div
              key={input.id}
              className="flex items-center gap-2 px-3 py-1.5"
              style={{ borderBottom: "1px solid var(--ws-border-subtle)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.65rem] font-medium" style={{ color: "var(--ws-text-muted)" }}>
                  {input.label}
                </div>
                <div className="truncate text-[0.55rem]" style={{ color: "var(--ws-text-dim)" }}>
                  {preview}
                </div>
              </div>
              <button
                onClick={() => handleEdit(input)}
                className="shrink-0 p-0.5 transition-colors hover:opacity-80"
                style={{ color: "var(--ws-text-dim)" }}
                title="Edit"
              >
                <PencilIcon className="size-3" />
              </button>
              <button
                onClick={() => handleRun(input.label)}
                disabled={isRunning}
                className="shrink-0 p-0.5 transition-colors hover:opacity-80 disabled:opacity-30"
                style={{ color: "var(--ws-accent)" }}
                title="Run"
              >
                <PlayIcon className="size-3" />
              </button>
            </div>
          );
        })}

        {mode.type === "create" && (
          <CreateInputForm
            keys={mode.keys}
            values={mode.values}
            isFirstInput={inputs.length === 0}
            onSave={handleSaveNew}
            onCancel={() => setMode({ type: "list" })}
          />
        )}

        {mode.type === "edit" && (() => {
          const input = inputs.find((i) => i.id === mode.inputId);
          if (!input) return null;
          const keys = Object.keys((input.inputData ?? {}) as Record<string, unknown>);
          return (
            <EditInputForm
              keys={keys}
              values={mode.values}
              isDirty={isDirty}
              isSaved={!isDirty}
              inputLabel={input.label}
              onValuesChange={(values) => setMode({ ...mode, values })}
              onSave={() => handleSaveEdit(mode.inputId, mode.values)}
              onRun={() => handleRun(input.label)}
              onDelete={async () => { await onDelete(mode.inputId); setMode({ type: "list" }); }}
              onCancel={() => setMode({ type: "list" })}
            />
          );
        })()}
      </div>
    </div>
  );
}

function CreateInputForm({
  keys: initialKeys,
  values: initialValues,
  isFirstInput,
  onSave,
  onCancel,
}: {
  keys: string[];
  values: Record<string, string>;
  isFirstInput: boolean;
  onSave: (keys: string[], values: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [values, setValues] = useState(initialValues);

  const hasValues = Object.values(values).some((v) => v.trim() !== "");

  return (
    <div className="p-3">
      <div className="flex flex-col gap-2">
        {keys.map((key, i) => (
          <div key={i} className="flex items-center gap-2">
            {isFirstInput ? (
              <input
                className="w-[80px] shrink-0 rounded border px-2 py-1 text-[0.65rem] font-mono"
                style={{ background: "var(--ws-surface)", borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
                placeholder="key"
                value={key}
                onChange={(e) => {
                  const newKeys = [...keys];
                  newKeys[i] = e.target.value;
                  setKeys(newKeys);
                }}
              />
            ) : (
              <span className="w-[80px] shrink-0 text-[0.65rem]" style={{ color: "var(--ws-text-muted)" }}>
                {key}
              </span>
            )}
            <input
              className="flex-1 rounded border px-2 py-1 text-[0.65rem] font-mono"
              style={{ background: "var(--ws-surface)", borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
              placeholder="value..."
              value={values[key] ?? ""}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
            {isFirstInput && (
              <button
                onClick={() => {
                  const newKeys = keys.filter((_, j) => j !== i);
                  setKeys(newKeys);
                }}
                className="shrink-0 p-0.5"
                style={{ color: "var(--ws-text-dim)" }}
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      {isFirstInput && (
        <button
          onClick={() => setKeys([...keys, ""])}
          className="mt-2 flex items-center gap-1 text-[0.6rem]"
          style={{ color: "var(--ws-accent)" }}
        >
          <PlusIcon className="size-3" />
          Add field
        </button>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded px-2 py-1 text-[0.6rem]"
          style={{ color: "var(--ws-text-muted)" }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(keys, values)}
          disabled={!hasValues}
          className="flex items-center gap-1 rounded px-2 py-1 text-[0.6rem] disabled:opacity-30"
          style={{ background: "var(--ws-accent-surface)", color: "var(--ws-accent)" }}
        >
          <SaveIcon className="size-3" />
          Save
        </button>
      </div>
    </div>
  );
}

function EditInputForm({
  keys,
  values,
  isDirty,
  isSaved,
  inputLabel,
  onValuesChange,
  onSave,
  onRun,
  onDelete,
  onCancel,
}: {
  keys: string[];
  values: Record<string, string>;
  isDirty: boolean;
  isSaved: boolean;
  inputLabel: string;
  onValuesChange: (values: Record<string, string>) => void;
  onSave: () => Promise<void>;
  onRun: () => Promise<void>;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[0.65rem] font-medium" style={{ color: "var(--ws-text)" }}>{inputLabel}</span>
        <button
          onClick={onDelete}
          className="p-0.5 transition-colors hover:opacity-80"
          style={{ color: "var(--ws-danger)" }}
          title="Delete input"
        >
          <TrashIcon className="size-3" />
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {keys.map((key) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-[80px] shrink-0 text-[0.65rem]" style={{ color: "var(--ws-text-muted)" }}>
              {key}
            </span>
            <input
              className="flex-1 rounded border px-2 py-1 text-[0.65rem] font-mono"
              style={{ background: "var(--ws-surface)", borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
              value={values[key] ?? ""}
              onChange={(e) => onValuesChange({ ...values, [key]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded px-2 py-1 text-[0.6rem]"
          style={{ color: "var(--ws-text-muted)" }}
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!isDirty}
          className="flex items-center gap-1 rounded px-2 py-1 text-[0.6rem] disabled:opacity-30"
          style={{ background: "var(--ws-accent-surface)", color: "var(--ws-accent)" }}
        >
          <SaveIcon className="size-3" />
          Save
        </button>
        <button
          onClick={onRun}
          disabled={!isSaved}
          className="flex items-center gap-1 rounded px-2 py-1 text-[0.6rem] disabled:opacity-30"
          style={{ background: "var(--ws-accent)", color: "#fff" }}
        >
          <PlayIcon className="size-3" />
          Run
        </button>
      </div>
    </div>
  );
}
