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
/**
 * @param fieldTypes Schema type per field name (e.g. `{ bullet_points: 'array' }`).
 *   Fields typed `array` collect EVERY node their xpath matches; everything else
 *   takes the first match as before. The plan itself carries no type information —
 *   it comes from the LLM — so the caller supplies it from its own schema.
 */
export function buildExtractionScript(
  plan: ExtractionPlan,
  fieldTypes: Record<string, string> = {},
  /**
   * The URL the markup came from, for resolving relative links.
   *
   * Row extraction runs against CAPTURED html, where `window.location` is
   * about:blank — so a relative href fails to absolutise, and the url-type guard
   * then nulls the field, silently dropping every link on any site that writes
   * its hrefs relatively.
   */
  baseUrl?: string,
): string {
  // `SelectorField.xpath` is typed `string`, but plans arrive as an unchecked
  // `as ExtractionPlan` cast over LLM tool output — and the tool is not `strict`,
  // so the model can omit xpath despite the schema marking it required. v1.1b's
  // reverse-search flow also legitimately produces fields carrying only an AI-seen
  // `value` and no selector.
  //
  // Drop those here so the generated in-page code never dereferences a missing
  // xpath. This is not cosmetic: the xpath-validation loop below is unguarded, so
  // one bad field used to throw inside page.evaluate and reject the ENTIRE pass,
  // discarding every well-formed field with it. The caller still delivers these
  // fields from `field.value` with source 'ai-vision'.
  const usableFields = plan.fields.filter(
    (f) => typeof f.xpath === 'string' && f.xpath.length > 0,
  );

  return `
    (() => {
      // Declared first: extractValue below reads it, and a const declared in a
      // later block is out of scope there — the ReferenceError was swallowed by
      // the transform's own catch, silently leaving every link relative.
      const BASE_URL = ${JSON.stringify(baseUrl ?? '')};

      function xpathQuery(contextNode, xpath) {
        try {
          // Determine context: absolute xpaths (start with /) use document,
          // relative xpaths (start with . or axis like following-sibling, ancestor, etc.) use contextNode
          const isAbsolute = xpath.startsWith('/');
          const node = isAbsolute ? document : contextNode;
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

      // Like xpathQuery, but returns every match, scoped the same way (absolute
      // xpaths from document, relative ones from contextNode).
      function xpathQueryAllFrom(contextNode, xpath) {
        try {
          const isAbsolute = xpath.startsWith('/');
          const node = isAbsolute ? document : contextNode;
          const result = document.evaluate(xpath, node, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          const nodes = [];
          for (let i = 0; i < result.snapshotLength; i++) nodes.push(result.snapshotItem(i));
          return nodes;
        } catch (e) {
          return [];
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

      // Check how many elements an XPath matches (0 = broken, 50+ = too broad)
      function xpathCount(xpath) {
        try {
          const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          return result.snapshotLength;
        } catch { return 0; }
      }

      function extractValue(el, field) {
        if (!el) return null;

        // Skip script, style, and hidden elements — they contain code, not data
        const tag = el.tagName?.toLowerCase?.() ?? '';
        if (tag === 'script' || tag === 'style' || tag === 'noscript') return null;
        if (el.closest?.('script') || el.closest?.('style')) return null;

        let value;
        // The xpath may already select the attribute node — models routinely write
        // .//a[@class="title"]/@href AND set attribute:"href". An attribute node has
        // no getAttribute, so this returned null, every field in the row was empty,
        // the row was dropped, and a page full of links yielded nothing. Falls
        // through to the transforms below: an href found this way still needs
        // absolute_url like any other.
        if (el.nodeType === 2) {
          value = el.nodeValue ?? el.value ?? null;
        } else if (field.attribute === 'textContent') {
          value = el.textContent?.trim() ?? null;
          // Reject values that look like code/JSON
          if (value && (value.startsWith('{') || value.startsWith('function ') || value.startsWith('[{') || value.length > 5000)) {
            return null;
          }
        } else {
          value = el.getAttribute ? el.getAttribute(field.attribute) : null;
        }

        if (value === null || value === '') return null;

        if (field.transform === 'trim') value = value.trim();
        if (field.transform === 'parse_number') {
          // Handle word-based numbers (e.g. "star-rating Three" → 3)
          const wordToNum = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5 };
          const wordMatch = value.toLowerCase().match(/\\b(zero|one|two|three|four|five)\\b/);
          if (wordMatch) {
            value = wordToNum[wordMatch[1]];
          } else {
            const num = parseFloat(value.replace(/[^0-9.-]/g, ''));
            value = isNaN(num) ? null : num;
          }
        }
        if (field.transform === 'parse_date') value = value.trim();
        if (field.transform === 'absolute_url' && value && !value.startsWith('http')) {
          try { value = new URL(value, BASE_URL || window.location.href).href; } catch {}
        }

        // Post-processing: clean up common junk patterns
        if (typeof value === 'string') {
          // "Visit the Apple Store" → "Apple"
          value = value.replace(/^Visit the\\s+/i, '').replace(/\\s+Store$/i, '').trim();
          // Remove "Shop now" / "Buy now" prefixes
          value = value.replace(/^(Shop|Buy|Order|Get)\\s+(now|it|this)?\\s*/i, '').trim();
          // Collapse multiple whitespace/newlines
          value = value.replace(/\\s+/g, ' ').trim();
        }

        // Plausibility checks based on transform/field hints
        if (value !== null) {
          const strVal = String(value);
          // Reject if extracted value is just whitespace or common boilerplate
          if (strVal.trim() === '' || strVal === 'undefined' || strVal === 'null') return null;
          // Reject numbers that are impossibly large (likely wrong element)
          if (field.transform === 'parse_number' && typeof value === 'number' && (value > 1e9 || value < -1e9)) return null;
          // Reject URLs that don't look like URLs
          if (field.transform === 'absolute_url' && typeof value === 'string' && !value.match(/^https?:\\/\\//)) return null;
        }

        return value;
      }

      const rowXpath = ${JSON.stringify(plan.row_xpath)};
      const fields = ${JSON.stringify(usableFields)};
      const pageType = ${JSON.stringify(plan.page_type ?? 'auto')};
      const fieldTypes = ${JSON.stringify(fieldTypes)};

      // Array-typed fields collect every matching node; everything else takes the
      // first match. Without this an array field can only ever return one node —
      // in practice the AI aims the xpath at the containing <ul>, whose collapsed
      // textContent then fails validation as "not array".
      function extractFrom(contextNode, field, xpath) {
        if (fieldTypes[field.name] === 'array') {
          const values = [];
          for (const node of xpathQueryAllFrom(contextNode, xpath)) {
            const v = extractValue(node, field);
            if (v !== null) values.push(v);
          }
          return values.length > 0 ? values : null;
        }
        return extractValue(xpathQuery(contextNode, xpath), field);
      }

      const rows = xpathQueryAll(rowXpath);
      const results = [];
      const matchCounts = {};

      fields.forEach(f => { matchCounts[f.name] = 0; });

      // Use page type hint if available, otherwise infer from row count
      const isListing = pageType === 'listing' || pageType === 'search_results' || pageType === 'table'
        ? true
        : pageType === 'detail'
          ? false
          : rows.length > 1;

      if (isListing) {
        // LISTING MODE: multiple rows, extract per-row
        for (const row of rows) {
          const item = {};
          for (const field of fields) {
            try {
              const value = extractFrom(row, field, field.xpath);
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
            let value = rows[0] ? extractFrom(rows[0], field, field.xpath) : null;

            // If not found, try as absolute XPath from document
            if (value === null) {
              // Convert relative xpath to absolute if needed
              const absXpath = field.xpath.startsWith('.')
                ? field.xpath.substring(1)
                : field.xpath.startsWith('/')
                  ? field.xpath
                  : '//' + field.xpath;
              value = extractFrom(document, field, absXpath);
            }

            if (value !== null) {
              item[field.name] = value;
              matchCounts[field.name]++;
            }
          } catch {}
        }
        if (Object.keys(item).length > 0) results.push(item);
      }

      // Validate XPaths — check element counts for quality signals
      const xpathValidation = {};
      for (const field of fields) {
        const absXpath = field.xpath.startsWith('.') ? field.xpath.substring(1) : field.xpath.startsWith('/') ? field.xpath : '//' + field.xpath;
        const count = xpathCount(absXpath);
        xpathValidation[field.name] = {
          elementCount: count,
          status: count === 0 ? 'broken' : count > 100 ? 'too_broad' : 'ok',
        };
      }

      return {
        data: results,
        matchRate: Object.fromEntries(
          fields.map(f => [f.name, Math.max(rows.length, 1) > 0 ? matchCounts[f.name] / Math.max(rows.length, 1) : 0])
        ),
        totalRows: Math.max(rows.length, results.length),
        xpathValidation,
      };
    })()
  `;
}
