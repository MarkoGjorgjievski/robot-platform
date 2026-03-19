import type { Page } from 'playwright';
import type { RunLogger } from './logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SchemaField {
  name: string;
  xpath?: string;
  css?: string;
  regExp?: string;
  regExpReplace?: string;
  defaultValue?: unknown;
  singleValue?: boolean;
  type?: string;
  transform?: string;
}

export interface SchemaData {
  singleRecord?: boolean;
  recordSelector?: string | null;
  recordXPath?: string | null;
  regionsSelector?: string | null;
  fields?: SchemaField[];
}

type RawRecord = Record<string, string | null>;

// ─── In-browser extraction function ──────────────────────────────────────────
// This is serialized and sent to page.evaluate(). It must be self-contained
// with no external references.

// ─── Server-side orchestration ───────────────────────────────────────────────

// The extraction script is a plain string to avoid esbuild __name decorators
// that break page.evaluate(). It's injected as a raw script into the browser.
const BROWSER_EXTRACT_SCRIPT = `(config) => {
  var extractTextField = function(root, field) {
    var text = null;
    if (field.xpath) {
      try {
        var result = document.evaluate(field.xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        var node = result.singleNodeValue;
        if (node) {
          text = node.nodeType === Node.ATTRIBUTE_NODE ? node.value : (node.textContent || '').trim() || null;
        }
      } catch(e) {}
    }
    if (text === null && field.css) {
      try {
        var el = root.querySelector(field.css);
        if (el) { text = (el.textContent || '').trim() || null; }
      } catch(e) {}
    }
    if (text !== null && field.regExp) {
      try {
        var re = new RegExp(field.regExp);
        if (field.regExpReplace !== undefined) {
          text = text.replace(re, field.regExpReplace);
        } else {
          var match = text.match(re);
          text = match ? (match[1] || match[0]) : null;
        }
      } catch(e) {}
    }
    if (text === null && field.defaultValue != null) {
      text = String(field.defaultValue);
    }
    return text;
  };
  var extractRecord = function(root, fields) {
    var record = {};
    for (var i = 0; i < fields.length; i++) {
      record[fields[i].name] = extractTextField(root, fields[i]);
    }
    return record;
  };
  var fields = config.fields;
  if (!fields || fields.length === 0) return [];
  if (config.singleRecord || (!config.recordXPath && !config.recordSelector)) {
    return [extractRecord(document, fields)];
  }
  var containers = [];
  if (config.recordXPath) {
    try {
      var result = document.evaluate(config.recordXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (var i = 0; i < result.snapshotLength; i++) {
        var node = result.snapshotItem(i);
        if (node && node.nodeType === Node.ELEMENT_NODE) containers.push(node);
      }
    } catch(e) {}
  } else if (config.recordSelector) {
    try {
      document.querySelectorAll(config.recordSelector).forEach(function(n) { containers.push(n); });
    } catch(e) {}
  }
  if (containers.length === 0) {
    return [extractRecord(document, fields)];
  }
  return containers.map(function(container) { return extractRecord(container, fields); });
}`;

interface BrowserFieldDef {
  name: string;
  xpath?: string;
  css?: string;
  regExp?: string;
  regExpReplace?: string;
  defaultValue?: string | null;
  singleValue?: boolean;
}

export async function extractData(
  page: Page,
  schema: SchemaData,
  logger: RunLogger,
): Promise<RawRecord[]> {
  const fields = schema.fields ?? [];
  if (fields.length === 0) {
    logger.info('No schema fields defined — skipping extraction');
    return [];
  }

  logger.info(`Extracting ${fields.length} fields (singleRecord=${schema.singleRecord ?? true})`);

  const browserFields: BrowserFieldDef[] = fields.map((f) => ({
    name: f.name,
    xpath: f.xpath,
    css: f.css,
    regExp: f.regExp,
    regExpReplace: f.regExpReplace,
    defaultValue: f.defaultValue != null ? String(f.defaultValue) : null,
    singleValue: f.singleValue,
  }));

  const config = {
    fields: browserFields,
    recordXPath: schema.recordXPath ?? null,
    recordSelector: schema.recordSelector ?? null,
    singleRecord: schema.singleRecord ?? true,
  };

  // Log the config being sent to the browser for debugging
  for (const f of browserFields) {
    logger.info(`  Field "${f.name}": xpath=${f.xpath ?? '(none)'} css=${f.css ?? '(none)'}`);
  }

  // Pass as string to page.evaluate to completely avoid esbuild transforms
  const records: RawRecord[] = await page.evaluate(
    `(${BROWSER_EXTRACT_SCRIPT})(${JSON.stringify(config)})`,
  ) as RawRecord[];

  logger.info(`Extracted ${records.length} record(s)`);

  return records;
}

// ─── Per-field transforms (server-side) ──────────────────────────────────────

export function applyFieldTransforms(
  records: RawRecord[],
  fields: SchemaField[],
  logger: RunLogger,
): RawRecord[] {
  // Build a map of field name → compiled transform function
  const transforms = new Map<string, (text: string | null, row: RawRecord) => string | null>();

  for (const field of fields) {
    if (!field.transform) continue;

    try {
      // Strip function wrapper: "function transform(text, row) { ... }" → "..."
      let body = field.transform.trim();
      const fnMatch = body.match(/^function\s+\w*\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
      if (fnMatch) {
        body = fnMatch[1];
      }
      const fn = new Function('text', 'row', body) as (text: string | null, row: RawRecord) => string | null;
      transforms.set(field.name, fn);
    } catch (e) {
      logger.warn(`Failed to compile transform for field "${field.name}": ${(e as Error).message}`);
    }
  }

  if (transforms.size === 0) return records;

  logger.info(`Applying per-field transforms for ${transforms.size} field(s)`);

  return records.map((record) => {
    const row = { ...record };
    for (const [name, fn] of transforms) {
      if (name in row) {
        try {
          row[name] = fn(row[name], row);
        } catch (e) {
          logger.warn(`Transform error on field "${name}": ${(e as Error).message}`);
        }
      }
    }
    return row;
  });
}

// ─── Global transform.js (backward compat) ──────────────────────────────────

export function applyGlobalTransform(
  records: RawRecord[],
  transformCode: string,
  logger: RunLogger,
): RawRecord[] {
  try {
    // The old transform.js exports { cleanUp }. Try to extract the cleanUp function.
    // We wrap the code so it can reference module.exports, then pull cleanUp from it.
    const wrappedCode = `
      const module = { exports: {} };
      const exports = module.exports;
      ${transformCode}
      return module.exports;
    `;
    const moduleExports = new Function(wrappedCode)() as Record<string, unknown>;

    if (typeof moduleExports.cleanUp === 'function') {
      // Old format: cleanUp receives Group[] with { group: [{ field: [{text}] }] }
      // We need to convert flat records → old format, run cleanUp, convert back
      const oldFormat = [{
        group: records.map((r) => {
          const row: Record<string, Array<{ text: string | null }>> = {};
          for (const [k, v] of Object.entries(r)) {
            row[k] = [{ text: v }];
          }
          return row;
        }),
        url: '',
        rows: records.length,
      }];

      const transformed = (moduleExports.cleanUp as (data: typeof oldFormat) => typeof oldFormat)(oldFormat);

      // Convert back to flat records
      return transformed[0]?.group.map((row: Record<string, Array<{ text: string | null }>>) => {
        const flat: RawRecord = {};
        for (const [k, v] of Object.entries(row)) {
          flat[k] = Array.isArray(v) && v.length > 0 ? v[0]?.text ?? null : null;
        }
        return flat;
      }) ?? records;
    }

    // If no cleanUp, try calling the module as a function
    if (typeof moduleExports === 'function') {
      return (moduleExports as (data: RawRecord[]) => RawRecord[])(records);
    }

    logger.warn('Global transform.js has no cleanUp function — skipping');
    return records;
  } catch (e) {
    logger.warn(`Global transform failed: ${(e as Error).message}`);
    return records;
  }
}
