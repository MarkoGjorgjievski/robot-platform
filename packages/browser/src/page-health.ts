/**
 * Detect blocked, error, or empty pages before processing.
 * Returns null if page is healthy, or an error description if blocked.
 */
export type PageHealthResult = {
  healthy: boolean;
  reason?: string;
  statusCode?: number;
};

/**
 * Check page health from HTML content + title.
 * Should be called AFTER page capture, BEFORE AI analysis.
 */
export function checkPageHealth(html: string, title: string, url: string): PageHealthResult {
  const lowerHtml = html.toLowerCase();
  const lowerTitle = title.toLowerCase();

  // 1. HTTP error pages
  const errorPatterns = [
    { match: '403 forbidden', reason: 'HTTP 403 Forbidden — site is blocking access', code: 403 },
    { match: '401 unauthorized', reason: 'HTTP 401 Unauthorized — authentication required', code: 401 },
    { match: '404 not found', reason: 'HTTP 404 Not Found — page does not exist', code: 404 },
    { match: '429 too many requests', reason: 'HTTP 429 Too Many Requests — rate limited', code: 429 },
    { match: '503 service unavailable', reason: 'HTTP 503 Service Unavailable', code: 503 },
    { match: '502 bad gateway', reason: 'HTTP 502 Bad Gateway', code: 502 },
  ];

  for (const pattern of errorPatterns) {
    if (lowerTitle.includes(pattern.match) || lowerHtml.slice(0, 2000).includes(pattern.match)) {
      return { healthy: false, reason: pattern.reason, statusCode: pattern.code };
    }
  }

  // 2. Bot detection / CAPTCHA pages
  const botPatterns = [
    { match: 'captcha', reason: 'CAPTCHA detected — site requires human verification' },
    { match: 'recaptcha', reason: 'reCAPTCHA detected — site requires human verification' },
    { match: 'hcaptcha', reason: 'hCaptcha detected — site requires human verification' },
    { match: 'robot', includes: ['are you a robot', 'not a robot', 'verify you are human', 'robot or human', 'confirm that you\'re human'] },
    { match: 'cloudflare', includes: ['checking your browser', 'just a moment', 'ray id'] },
    { match: 'perimeterx', reason: 'PerimeterX bot detection — site blocked automated access' },
    { match: 'datadome', reason: 'DataDome bot detection — site blocked automated access' },
    { match: 'access denied', reason: 'Access denied — site is blocking automated access' },
    { match: 'blocked', includes: ['your request has been blocked', 'this request was blocked', 'automated access'] },
  ];

  for (const pattern of botPatterns) {
    if ('includes' in pattern && pattern.includes) {
      // Must match the main keyword AND one of the secondary phrases
      if (lowerHtml.includes(pattern.match)) {
        const hasSecondary = pattern.includes.some(s => lowerHtml.includes(s));
        if (hasSecondary) {
          return { healthy: false, reason: `Bot detection (${pattern.match}) — site blocked automated access` };
        }
      }
    } else if (lowerTitle.includes(pattern.match) || lowerHtml.slice(0, 5000).includes(pattern.match)) {
      if (pattern.reason) {
        return { healthy: false, reason: pattern.reason };
      }
    }
  }

  // 3. Soft 404 / error pages (HTTP 200 but page is an error)
  const soft404Patterns = [
    // Amazon "dogs of Amazon" error page
    { title: ["sorry", "page not found", "couldn't find"], body: ["try searching", "go to", "home page"] },
    // Generic soft 404s
    { title: ["not found", "404", "page not found", "doesn't exist", "no longer available"], body: [] },
    // "Oops" error pages
    { title: ["oops", "something went wrong", "error"], body: ["try again", "go back", "home page"] },
  ];

  for (const pattern of soft404Patterns) {
    const titleMatch = pattern.title.some(t => lowerTitle.includes(t));
    if (titleMatch) {
      if (pattern.body.length === 0) {
        return { healthy: false, reason: 'Soft 404 — page title indicates error or not found', statusCode: 404 };
      }
      const bodyMatch = pattern.body.some(b => lowerHtml.slice(0, 10000).includes(b));
      if (bodyMatch) {
        return { healthy: false, reason: 'Soft 404 — page appears to be an error page', statusCode: 404 };
      }
    }
  }

  // 4. Empty or minimal page
  // Strip tags and check text content length
  const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (textContent.length < 100) {
    return { healthy: false, reason: 'Page has almost no content (less than 100 characters of text)' };
  }

  // 5. Check if body is essentially empty (only scripts/styles)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    const bodyContent = bodyMatch[1]
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<link[^>]*>/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (bodyContent.length < 50) {
      return { healthy: false, reason: 'Page body is empty (only scripts/styles, no visible content)' };
    }
  }

  return { healthy: true };
}
