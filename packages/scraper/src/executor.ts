import type { ExtractionPlan } from '@robot/agent';

export type ExecutorResult = {
  data: Record<string, unknown>[];
  matchRate: Record<string, number>;
  totalRows: number;
};

/**
 * Build a self-contained script that runs inside a Playwright page via page.evaluate().
 * Uses XPath for all selectors — supports sibling traversal, ancestor access, etc.
 *
 * Handles two page types:
 * - Listing pages: row_xpath matches multiple items, field XPaths are relative to each row
 * - Detail pages: row_xpath matches 0-1 items, field XPaths are tried as absolute from document
 */
export function buildExtractionScript(plan: ExtractionPlan): string {
  return `
    (() => {
      function xpathQuery(contextNode, xpath) {
        try {
          // If xpath starts with / or //, evaluate from document root
          // If it starts with . or is relative, evaluate from context
          const node = xpath.startsWith('.') ? contextNode : document;
          const result = document.evaluate(
            xpath,
            node,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          return result.singleNodeValue;
        } catch (e) {
          return null;
        }
      }

      function xpathQueryAll(xpath) {
        try {
          const result = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
          );
          const nodes = [];
          for (let i = 0; i < result.snapshotLength; i++) {
            nodes.push(result.snapshotItem(i));
          }
          return nodes;
        } catch (e) {
          return [];
        }
      }

      function extractValue(el, field) {
        if (!el) return null;

        // Skip script, style, and hidden elements — they contain code, not data
        const tag = el.tagName?.toLowerCase?.() ?? '';
        if (tag === 'script' || tag === 'style' || tag === 'noscript') return null;
        if (el.closest?.('script') || el.closest?.('style')) return null;

        let value;
        if (field.attribute === 'textContent') {
          value = el.textContent?.trim() ?? null;
          // Reject values that look like code/JSON (starts with { or function)
          if (value && (value.startsWith('{') || value.startsWith('function ') || value.startsWith('[{') || value.length > 5000)) {
            return null;
          }
        } else {
          value = el.getAttribute ? el.getAttribute(field.attribute) : null;
        }

        if (value === null || value === '') return null;

        if (field.transform === 'trim') value = value.trim();
        if (field.transform === 'parse_number') {
          const num = parseFloat(value.replace(/[^0-9.-]/g, ''));
          value = isNaN(num) ? null : num;
        }
        if (field.transform === 'parse_date') value = value.trim();
        if (field.transform === 'absolute_url' && value && !value.startsWith('http')) {
          try { value = new URL(value, window.location.href).href; } catch {}
        }

        return value;
      }

      const rowXpath = ${JSON.stringify(plan.row_xpath)};
      const fields = ${JSON.stringify(plan.fields)};
      const rows = xpathQueryAll(rowXpath);
      const results = [];
      const matchCounts = {};

      fields.forEach(f => { matchCounts[f.name] = 0; });

      if (rows.length > 1) {
        // LISTING MODE: multiple rows, extract per-row
        for (const row of rows) {
          const item = {};
          for (const field of fields) {
            try {
              const el = xpathQuery(row, field.xpath);
              const value = extractValue(el, field);
              if (value !== null) {
                item[field.name] = value;
                matchCounts[field.name]++;
              }
            } catch {}
          }
          if (Object.keys(item).length > 0) results.push(item);
        }
      } else {
        // DETAIL MODE: single item page (product detail, article, etc.)
        // Use document as context, try each field XPath as absolute
        const item = {};
        for (const field of fields) {
          try {
            // Try relative to row first (if row exists)
            let el = rows[0] ? xpathQuery(rows[0], field.xpath) : null;

            // If not found, try as absolute XPath from document
            if (!el) {
              // Convert relative xpath to absolute if needed
              const absXpath = field.xpath.startsWith('.')
                ? field.xpath.substring(1)
                : field.xpath.startsWith('/')
                  ? field.xpath
                  : '//' + field.xpath;
              el = xpathQuery(document, absXpath);
            }

            const value = extractValue(el, field);
            if (value !== null) {
              item[field.name] = value;
              matchCounts[field.name]++;
            }
          } catch {}
        }
        if (Object.keys(item).length > 0) results.push(item);
      }

      return {
        data: results,
        matchRate: Object.fromEntries(
          fields.map(f => [f.name, Math.max(rows.length, 1) > 0 ? matchCounts[f.name] / Math.max(rows.length, 1) : 0])
        ),
        totalRows: Math.max(rows.length, results.length),
      };
    })()
  `;
}
