import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { url, fieldName, desiredValue, clickedElement } = await request.json();

    if (!url || !fieldName || !desiredValue) {
      return NextResponse.json({ error: 'url, fieldName, and desiredValue are required' }, { status: 400 });
    }

    const { PlaywrightBrowser } = await import('@robot/browser');

    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });

    let result;
    try {
      const capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });

      // Strategy 1: If user clicked an element, validate and refine its XPath
      let bestXPath = clickedElement?.xpath ?? null;
      let xpathVerified = false;

      if (bestXPath) {
        // Verify the XPath returns something containing the desired value
        const verifyScript = `
          (() => {
            try {
              const result = document.evaluate(${JSON.stringify(bestXPath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              const el = result.singleNodeValue;
              if (!el) return { found: false };
              return {
                found: true,
                text: el.textContent?.trim() ?? '',
                tag: el.tagName?.toLowerCase() ?? '',
              };
            } catch { return { found: false }; }
          })()
        `;
        const verification = await browser.evaluate<{ found: boolean; text?: string; tag?: string }>(url, verifyScript, { waitUntil: 'domcontentloaded' });
        xpathVerified = verification.found && (verification.text?.includes(desiredValue) ?? false);
      }

      // Strategy 2: Search API responses for the desired value
      let bestApiPath: string | null = null;
      for (const req of capture.interceptedRequests) {
        if (!req.parsedJson) continue;
        const path = findValueInJson(req.parsedJson, desiredValue);
        if (path) {
          bestApiPath = path;
          break;
        }
      }

      // Strategy 3: Search JSON-LD
      let bestLdPath: string | null = null;
      for (const ld of capture.structuredData.ldJson) {
        const path = findValueInJson(ld, desiredValue);
        if (path) {
          bestLdPath = 'jsonld.' + path;
          break;
        }
      }

      // Strategy 4: Search meta tags
      let bestMetaKey: string | null = null;
      for (const [key, value] of Object.entries(capture.structuredData.meta)) {
        if (String(value).includes(desiredValue)) {
          bestMetaKey = key;
          break;
        }
      }

      // Determine transform rule
      const transform = inferTransform(clickedElement?.rawText ?? '', desiredValue);

      result = {
        fieldName,
        desiredValue,
        paths: {
          xpath: bestXPath ? {
            path: bestXPath,
            verified: xpathVerified,
            rawText: clickedElement?.trimmedText ?? null,
          } : null,
          api: bestApiPath ? { path: bestApiPath } : null,
          jsonLd: bestLdPath ? { path: bestLdPath } : null,
          meta: bestMetaKey ? { path: bestMetaKey } : null,
        },
        transform,
        recommendation: bestApiPath ? 'api' : xpathVerified ? 'xpath' : bestLdPath ? 'jsonLd' : bestMetaKey ? 'meta' : 'xpath',
      };
    } finally {
      await browser.close();
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('Find path error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Path search failed' },
      { status: 500 }
    );
  }
}

/**
 * Recursively search a JSON object for a value, return the dot-notation path.
 */
function findValueInJson(obj: unknown, targetValue: string, path = ''): string | null {
  if (obj === null || obj === undefined) return null;

  if (typeof obj === 'string' || typeof obj === 'number') {
    const strVal = String(obj);
    if (strVal === targetValue || strVal.includes(targetValue)) {
      return path;
    }
    // Also try numeric comparison
    const numTarget = parseFloat(targetValue.replace(/[^0-9.-]/g, ''));
    const numVal = typeof obj === 'number' ? obj : parseFloat(strVal.replace(/[^0-9.-]/g, ''));
    if (!isNaN(numTarget) && !isNaN(numVal) && Math.abs(numTarget - numVal) < 0.01) {
      return path;
    }
    return null;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 5); i++) {
      const found = findValueInJson(obj[i], targetValue, `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const fullPath = path ? `${path}.${key}` : key;
      const found = findValueInJson(value, targetValue, fullPath);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Infer what transform is needed to go from raw element text to desired value.
 */
function inferTransform(rawText: string, desiredValue: string): string {
  if (!rawText || rawText.trim() === desiredValue) return 'trim';

  // Check if it's a number extraction (e.g. "$19.99" → "19.99")
  const numDesired = parseFloat(desiredValue.replace(/[^0-9.-]/g, ''));
  if (!isNaN(numDesired) && rawText.match(/[^0-9.-]/)) {
    return 'parse_number';
  }

  // Check if desired is a URL
  if (desiredValue.startsWith('http') || desiredValue.startsWith('/')) {
    return 'absolute_url';
  }

  return 'trim';
}
