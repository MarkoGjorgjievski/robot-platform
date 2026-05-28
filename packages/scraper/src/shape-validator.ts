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
      const hasCore = value.some((v: Record<string, unknown>) => {
        return (v.sku != null && v.sku !== '')
          || (v.price != null && v.price !== '')
          || (v.image_url != null && v.image_url !== '');
      });
      if (!hasCore) return { ok: false, reason: 'no core fields (sku/price/image_url) on any item' };
      return { ok: true, normalized: value };
    }
    default:
      return { ok: true, normalized: value };
  }
}
