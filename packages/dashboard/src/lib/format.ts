export function formatValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * A HUMAN summary of a structured value, for table cells and review panels.
 * `formatValue` answers "what exactly is stored" (JSON); this answers "what
 * is this, roughly" — a variants array reads as `5 items · sku, size, color…`
 * instead of a wall of braces.
 */
export function previewValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v))) {
      const keys = Object.keys(value[0] as object);
      const shown = keys.slice(0, 5).join(', ') + (keys.length > 5 ? ', …' : '');
      return `${value.length} ${value.length === 1 ? 'item' : 'items'} · ${shown}`;
    }
    return value.map((v) => formatValue(v)).join(' · ');
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const shown = entries.slice(0, 4).map(([k, v]) => `${k}: ${formatValue(v)}`).join(' · ');
    return entries.length > 4 ? `${shown} · …` : shown;
  }
  return formatValue(value);
}

export function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const m = Math.floor(diffMs / 60_000);
  const h = Math.floor(diffMs / 3_600_000);
  const d = Math.floor(diffMs / 86_400_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
