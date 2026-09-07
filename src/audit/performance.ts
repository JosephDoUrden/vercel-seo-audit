import type { AuditContext, AuditFinding } from '../types.js';
import { fetchPage } from '../utils/http.js';
import { getHeadScripts } from '../utils/html-parser.js';

const KB = 1024;
const MB = 1024 * KB;

// JavaScript MIME type essences per the HTML spec. A <script> with any other type is a data block.
const JAVASCRIPT_MIME_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

/**
 * No type or an empty type means a classic script; otherwise the trimmed value has to be a
 * JavaScript MIME type essence. A whitespace-only type trims to nothing and is a data block,
 * which is also what browsers do.
 */
function isClassicScript(type: string | null): boolean {
  if (type === null || type === '') return true;
  return JAVASCRIPT_MIME_TYPES.has(type.trim().toLowerCase());
}

export async function auditPerformance(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const { normalizedUrl, fetchOptions } = ctx;

  let html: string;
  if (ctx.html) {
    html = ctx.html;
  } else {
    try {
      const res = await fetchPage(normalizedUrl, fetchOptions);
      html = res.body;
    } catch {
      return findings;
    }
  }

  // 1. HTML size check
  const htmlSize = Buffer.byteLength(html, 'utf-8');
  if (htmlSize > 1 * MB) {
    findings.push({
      code: 'HTML_SIZE_WARNING',
      severity: 'warning',
      category: 'performance',
      message: `HTML document is ${(htmlSize / KB).toFixed(0)} KB (exceeds 1 MB)`,
      explanation:
        'Very large HTML documents increase Time to First Byte (TTFB) and slow down parsing, hurting Core Web Vitals and SEO rankings.',
      suggestion:
        'Reduce HTML size by deferring non-critical content, paginating long lists, or lazy-loading below-the-fold sections.',
      url: normalizedUrl,
      details: { bytes: htmlSize },
    });
  } else if (htmlSize > 500 * KB) {
    findings.push({
      code: 'HTML_SIZE_WARNING',
      severity: 'info',
      category: 'performance',
      message: `HTML document is ${(htmlSize / KB).toFixed(0)} KB (exceeds 500 KB)`,
      explanation:
        'Large HTML documents can slow down initial page load and parsing, which may negatively affect Core Web Vitals.',
      suggestion:
        'Consider reducing HTML size by deferring non-critical content or lazy-loading below-the-fold sections.',
      url: normalizedUrl,
      details: { bytes: htmlSize },
    });
  }

  // 2. Render-blocking scripts in <head>: external classic scripts without async or defer.
  // Inline scripts have nothing to download, and data blocks (ld+json, importmap,
  // speculationrules, any non-JavaScript type) are never executed, so none of them qualify.
  const blocking = getHeadScripts(html)
    .filter((s) => s.src && !s.async && !s.defer && isClassicScript(s.type))
    .map((s) => s.src as string);
  if (blocking.length > 0) {
    findings.push({
      code: 'RENDER_BLOCKING_SCRIPT',
      severity: 'warning',
      category: 'performance',
      message: `${blocking.length} render-blocking <script> tag${blocking.length === 1 ? '' : 's'} in <head> without async or defer`,
      explanation:
        'External scripts in <head> without async or defer block HTML parsing until they are downloaded and executed, delaying First Contentful Paint.',
      suggestion:
        'Add the async or defer attribute to <script> tags in <head>, use type="module", or move them to the end of <body>.',
      url: normalizedUrl,
      details: { count: blocking.length, srcs: blocking },
    });
  }

  // 3. Large inline styles
  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleRegex.exec(html)) !== null) {
    const styleSize = Buffer.byteLength(styleMatch[1], 'utf-8');
    if (styleSize > 50 * KB) {
      findings.push({
        code: 'LARGE_INLINE_STYLE',
        severity: 'warning',
        category: 'performance',
        message: `Inline <style> block is ${(styleSize / KB).toFixed(0)} KB (exceeds 50 KB)`,
        explanation:
          'Large inline style blocks increase HTML size and cannot be cached separately by the browser, slowing down repeat visits.',
        suggestion:
          'Extract large CSS into external stylesheets that can be cached independently.',
        url: normalizedUrl,
        details: { bytes: styleSize },
      });
    }
  }

  // 4. Missing preconnect for third-party origins
  const pageOrigin = new URL(normalizedUrl).origin;

  const thirdPartyOrigins = new Set<string>();
  const srcRegex = /<(?:script|link|img)\b[^>]*(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let srcMatch;
  while ((srcMatch = srcRegex.exec(html)) !== null) {
    try {
      const url = new URL(srcMatch[1], normalizedUrl);
      if (url.origin !== pageOrigin && url.protocol.startsWith('http')) {
        thirdPartyOrigins.add(url.origin);
      }
    } catch {
      // ignore invalid URLs
    }
  }

  if (thirdPartyOrigins.size > 0) {
    const preconnectRegex = /<link\b[^>]*rel\s*=\s*["']preconnect["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const preconnectHrefFirst = /<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']preconnect["'][^>]*>/gi;
    const preconnectedOrigins = new Set<string>();

    let pcMatch;
    while ((pcMatch = preconnectRegex.exec(html)) !== null) {
      try {
        preconnectedOrigins.add(new URL(pcMatch[1]).origin);
      } catch { /* ignore */ }
    }
    while ((pcMatch = preconnectHrefFirst.exec(html)) !== null) {
      try {
        preconnectedOrigins.add(new URL(pcMatch[1]).origin);
      } catch { /* ignore */ }
    }

    const missingOrigins = [...thirdPartyOrigins].filter((o) => !preconnectedOrigins.has(o));
    if (missingOrigins.length > 0) {
      findings.push({
        code: 'MISSING_PRECONNECT',
        severity: 'info',
        category: 'performance',
        message: `No <link rel="preconnect"> for ${missingOrigins.length} third-party origin(s)`,
        explanation:
          'Preconnect hints allow the browser to set up connections to third-party origins early, reducing latency for critical resources.',
        suggestion:
          `Add <link rel="preconnect" href="..."> for: ${missingOrigins.join(', ')}`,
        url: normalizedUrl,
        details: { origins: missingOrigins },
      });
    }
  }

  return findings;
}
