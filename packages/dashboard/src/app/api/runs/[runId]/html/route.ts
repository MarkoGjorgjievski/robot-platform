import { NextRequest, NextResponse } from 'next/server';
import { api } from '@/trpc/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  try {
    const data = await api.runs.getDetails({ id: runId });
    if (!data.html) {
      return new NextResponse('No HTML available', { status: 404 });
    }

    // Get the original URL for <base href> so relative resources resolve correctly
    const results = data.results as Record<string, unknown> | null;
    const finalUrl = results?.finalUrl as string | undefined;
    let baseTag = '';
    if (finalUrl) {
      try {
        const origin = new URL(finalUrl).origin;
        baseTag = `<base href="${origin}/">`;
      } catch {}
    }

    // Highlight script — listens for postMessage from parent to highlight elements
    const highlightScript = `<script>
window.addEventListener('message', function(e) {
  if (!e.data || e.data.type !== 'highlight') return;
  document.querySelectorAll('[data-rp-highlight]').forEach(function(el) {
    el.style.outline = '';
    el.style.backgroundColor = '';
    el.removeAttribute('data-rp-highlight');
  });
  var sel = e.data.selector;
  if (!sel || !sel.value) return;
  var els = [];
  try {
    if (sel.type === 'css') {
      els = Array.from(document.querySelectorAll(sel.value));
    } else if (sel.type === 'xpath') {
      var result = document.evaluate(sel.value, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (var i = 0; i < result.snapshotLength; i++) els.push(result.snapshotItem(i));
    }
  } catch(ex) {}
  els.forEach(function(el) {
    if (el && el.style) {
      el.style.outline = '2px solid #3b82f6';
      el.style.backgroundColor = 'rgba(59,130,246,0.1)';
      el.setAttribute('data-rp-highlight', '1');
    }
  });
  if (els.length > 0 && els[0].scrollIntoView) {
    els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
</script>`;

    let html = data.html;

    // Inject <base> tag at the start of <head> for resource resolution
    if (baseTag) {
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${baseTag}`);
      } else if (html.includes('<head ')) {
        html = html.replace(/<head\s[^>]*>/, `$&${baseTag}`);
      } else {
        html = baseTag + html;
      }
    }

    // Inject highlight script before </body>
    if (html.includes('</body>')) {
      html = html.replace('</body>', highlightScript + '</body>');
    } else {
      html = html + highlightScript;
    }

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new NextResponse('Run not found', { status: 404 });
  }
}
