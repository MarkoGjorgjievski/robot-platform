const UI_LABEL_PATTERNS = [
  /^(customer reviews|reviews|ratings|add to cart|buy now|out of stock|in stock|details|specifications|description|features|overview)$/i,
];

const DESCRIPTION_MIN_LENGTH = 20;

export type ValidateResult =
  | { ok: true; normalized: unknown }
  | { ok: false; reason: string };

export function validateFieldShape(
  value: unknown,
  type: string,
  opts: { fieldName?: string } = {},
): ValidateResult {
  if (value === null || value === undefined) return { ok: false, reason: 'null' };

  switch (type) {
    case 'number': {
      if (typeof value === 'number') return { ok: true, normalized: value };
      if (typeof value === 'string') {
        const cleaned = value.replace(/[$,€£¥\s]/g, '').trim();
        const n = Number(cleaned);
        if (!Number.isNaN(n) && cleaned.length > 0) return { ok: true, normalized: n };
        return { ok: false, reason: 'not numeric' };
      }
      return { ok: false, reason: 'not numeric' };
    }
    case 'array': {
      if (!Array.isArray(value)) return { ok: false, reason: 'not array' };
      if (value.length === 0) return { ok: false, reason: 'empty array' };
      return { ok: true, normalized: value };
    }
    case 'string': {
      if (typeof value !== 'string') return { ok: false, reason: 'not string' };
      // An empty value is "not found", never a resolved value. Found by pointing
      // the Tier 1 fixtures at the production chain: the fixture harness had
      // always rejected '' in its own copy of tryAssign and production never did,
      // so empty strings counted toward "resolved" — which is how a dogfood report
      // came to list `main_image_url: ""` as a successfully extracted field.
      if (value.trim() === '') return { ok: false, reason: 'empty string' };
      if (UI_LABEL_PATTERNS.some(p => p.test(value.trim()))) {
        return { ok: false, reason: 'looks like UI label' };
      }
      if (opts.fieldName === 'description' && value.trim().length < DESCRIPTION_MIN_LENGTH) {
        return { ok: false, reason: 'description too short' };
      }
      return { ok: true, normalized: value };
    }
    case 'variant_array': {
      if (!Array.isArray(value)) return { ok: false, reason: 'not array' };
      if (value.length === 0) return { ok: false, reason: 'empty array' };
      const allObjects = value.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v));
      if (!allObjects) return { ok: false, reason: 'items must be plain objects' };
      // Accept the array when every item has at least ONE recognized variant
      // axis (core or discovered). The intent is to keep recommendations
      // carousels out (which carry name/description/url, no axes) while
      // letting through real variants whose SKU/price aren't visible on the
      // current screenshot tile.
      const RECOGNIZED_AXES = new Set([
        'sku', 'price', 'image_url',
        'color', 'size', 'capacity', 'finish', 'material', 'pattern', 'quantity',
      ]);
      const hasAnyAxis = value.every((v: Record<string, unknown>) => {
        for (const k of Object.keys(v)) {
          if (RECOGNIZED_AXES.has(k) && v[k] != null && v[k] !== '') return true;
        }
        return false;
      });
      if (!hasAnyAxis) return { ok: false, reason: 'no recognized variant axes on every item (likely a recommendations carousel, not variants)' };
      return { ok: true, normalized: value };
    }
    default:
      return { ok: true, normalized: value };
  }
}
