import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * Captures a page and returns the HTML with an injected click handler overlay.
 * Used for the element picker in the field correction flow.
 */
export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const { PlaywrightBrowser } = await import('@robot/browser');

    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });

    let html: string;
    try {
      const capture = await browser.capture(url, { waitUntil: 'networkidle' });
      html = capture.html;
    } finally {
      await browser.close();
    }

    // Inject the click handler overlay script before </body>
    const overlayScript = buildOverlayScript();
    html = html.replace('</body>', `${overlayScript}</body>`);

    // Set base href so relative URLs resolve correctly
    const baseTag = `<base href="${url}">`;
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${baseTag}`);
    } else {
      html = `${baseTag}${html}`;
    }

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (err) {
    console.error('Page frame error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to capture page' },
      { status: 500 }
    );
  }
}

function buildOverlayScript(): string {
  return `
<style>
  .__robot-highlight {
    outline: 2px solid #3b82f6 !important;
    outline-offset: 2px !important;
    cursor: crosshair !important;
    background: rgba(59, 130, 246, 0.08) !important;
  }
  .__robot-selected {
    outline: 3px solid #16a34a !important;
    outline-offset: 2px !important;
    background: rgba(22, 163, 74, 0.08) !important;
  }
  .__robot-overlay-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 999999;
    background: #1e293b;
    color: white;
    padding: 8px 16px;
    font: 13px/1.4 system-ui, sans-serif;
    display: flex;
    align-items: center;
    gap: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .__robot-overlay-bar span {
    opacity: 0.7;
  }
</style>
<div class="__robot-overlay-bar">
  <span>Click on the element you want to extract</span>
  <span id="__robot-xpath-display" style="font-family: monospace; font-size: 11px; opacity: 0.5; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span>
</div>
<script>
(function() {
  let lastHighlight = null;

  // Generate a robust XPath for an element
  function generateXPath(el) {
    if (!el || el === document.body || el === document.documentElement) return '//body';

    const parts = [];
    let current = el;

    while (current && current !== document.body) {
      let selector = '';

      // Strategy 1: id (most reliable)
      if (current.id && !current.id.match(/^[0-9]/) && !current.id.includes(':')) {
        parts.unshift('//' + current.tagName.toLowerCase() + '[@id="' + current.id + '"]');
        return parts.join('');
      }

      // Strategy 2: data-testid or data-test
      const testId = current.getAttribute('data-testid') || current.getAttribute('data-test');
      if (testId) {
        parts.unshift('//' + current.tagName.toLowerCase() + '[@data-test' + (current.getAttribute('data-testid') ? 'id' : '') + '="' + testId + '"]');
        return parts.join('');
      }

      // Strategy 3: data-* attributes (except data-reactid, data-v-, etc.)
      for (const attr of current.attributes) {
        if (attr.name.startsWith('data-') &&
            !attr.name.match(/^data-(react|v-|gtm|analytics|track)/) &&
            attr.value.length < 50) {
          parts.unshift('//' + current.tagName.toLowerCase() + '[@' + attr.name + '="' + attr.value + '"]');
          return parts.join('');
        }
      }

      // Strategy 4: role attribute
      const role = current.getAttribute('role');
      if (role && ['main', 'article', 'heading', 'listitem', 'cell'].includes(role)) {
        parts.unshift('//' + current.tagName.toLowerCase() + '[@role="' + role + '"]');
        return parts.join('');
      }

      // Strategy 5: semantic class name (not auto-generated)
      const classes = Array.from(current.classList || []).filter(c =>
        c.length > 2 && c.length < 40 &&
        !c.match(/^[a-z]{1,2}[0-9]/) &&  // skip auto-generated like "a3", "css-1x"
        !c.match(/^_/) &&                   // skip _private
        !c.includes('__')                    // skip BEM modifiers... actually keep BEM
      );
      if (classes.length > 0) {
        selector = '//' + current.tagName.toLowerCase() + '[contains(@class, "' + classes[0] + '")]';
      } else {
        // Strategy 6: positional (last resort)
        const tag = current.tagName.toLowerCase();
        const siblings = Array.from(current.parentElement?.children || []).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector = '/' + tag + '[' + idx + ']';
        } else {
          selector = '/' + tag;
        }
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return '/' + parts.join('').replace(/^\\/\\//, '//');
  }

  // Highlight on hover
  document.addEventListener('mouseover', function(e) {
    if (e.target.closest('.__robot-overlay-bar')) return;
    if (lastHighlight) lastHighlight.classList.remove('__robot-highlight');
    e.target.classList.add('__robot-highlight');
    lastHighlight = e.target;

    const xpath = generateXPath(e.target);
    document.getElementById('__robot-xpath-display').textContent = xpath;
  }, true);

  document.addEventListener('mouseout', function(e) {
    if (e.target.classList) e.target.classList.remove('__robot-highlight');
  }, true);

  // Capture click
  document.addEventListener('click', function(e) {
    if (e.target.closest('.__robot-overlay-bar')) return;
    e.preventDefault();
    e.stopPropagation();

    if (lastHighlight) lastHighlight.classList.remove('__robot-highlight');
    e.target.classList.add('__robot-selected');

    const el = e.target;
    const xpath = generateXPath(el);
    const rawText = el.textContent || '';
    const trimmedText = rawText.trim();
    const tag = el.tagName.toLowerCase();
    const attrs = {};
    for (const a of el.attributes) {
      if (['href', 'src', 'alt', 'title', 'value', 'content', 'data-value', 'aria-label'].includes(a.name)) {
        attrs[a.name] = a.value;
      }
    }

    // Send to parent window
    window.parent.postMessage({
      type: '__robot_element_selected',
      xpath,
      rawText,
      trimmedText,
      tag,
      attrs,
      innerHTML: el.innerHTML.slice(0, 500),
      outerHTML: el.outerHTML.slice(0, 1000),
      rect: el.getBoundingClientRect(),
    }, '*');
  }, true);
})();
</script>`;
}
