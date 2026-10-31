import type { AuditContext, AuditFinding } from '../types.js';
import { fetchPage } from '../utils/http.js';
import { getHeadScripts } from '../utils/html-parser.js';
import { GOOGLEBOT_HTML_LIMIT_BYTES } from '../constants.js';

const KB = 1024;
const MB = 1024 * KB;

// The elements Search reads its title, snippet, canonical, indexing rules, rich results and
// heading from. Each pattern finds the element's first start tag in the raw HTML.
const INDEXED_ELEMENTS: readonly (readonly [string, RegExp])[] = [
  ['<title>', /<title[\s>]/i],
  ['meta description', /<meta\b[^>]*\bname\s*=\s*["']?description\b/i],
  ['canonical <link>', /<link\b[^>]*\brel\s*=\s*["']?canonical\b/i],
  ['robots meta', /<meta\b[^>]*\bname\s*=\s*["']?robots\b/i],
  ['JSON-LD', /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json/i],
  ['<h1>', /<h1[\s>]/i],
];

// A Next.js App Router flight-data chunk: an inline script that calls self.__next_f.push(.
const RSC_SCRIPT = /<script\b[^>]*>\s*self\.__next_f\.push\([\s\S]*?<\/script>/gi;

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
        'Very large HTML documents increase Time to First Byte (TTFB) and slow down parsing, hurting Core Web Vitals and SEO rankings. Googlebot reads only the first 2 MB of an HTML file and does not index the rest.',
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
        'Large HTML documents can slow down initial page load and parsing, which may negatively affect Core Web Vitals. Googlebot reads only the first 2 MB of an HTML file and does not index the rest.',
      suggestion:
        'Consider reducing HTML size by deferring non-critical content or lazy-loading below-the-fold sections.',
      url: normalizedUrl,
      details: { bytes: htmlSize },
    });
  }

  // 1b. Indexed elements Googlebot never reads. Only a page over the limit can have one, so
  // smaller pages skip the search. Offsets are UTF-8 bytes: the regex index is a UTF-16 index,
  // and the byte length of everything before it is where the element starts on the wire.
  if (htmlSize > GOOGLEBOT_HTML_LIMIT_BYTES) {
    const elements: { tag: string; offsetBytes: number }[] = [];
    for (const [tag, pattern] of INDEXED_ELEMENTS) {
      const index = html.search(pattern);
      if (index === -1) continue;
      const offsetBytes = Buffer.byteLength(html.slice(0, index), 'utf-8');
      if (offsetBytes >= GOOGLEBOT_HTML_LIMIT_BYTES) elements.push({ tag, offsetBytes });
    }
    if (elements.length > 0) {
      findings.push({
        code: 'HTML_PAST_GOOGLEBOT_LIMIT',
        severity: 'error',
        category: 'performance',
        message: `${elements.map((e) => e.tag).join(', ')} start${elements.length === 1 ? 's' : ''} past the first 2 MB of the HTML, which Googlebot does not read`,
        explanation:
          'Googlebot reads the first 2 MB of an HTML file, counted uncompressed, then stops the fetch and sends only that part for indexing. Anything that starts after the cut-off is not indexed.',
        suggestion:
          'Move these elements earlier in the document, ideally into <head>, and cut what comes before them: inline styles and scripts, serialised data and long lists.',
        url: normalizedUrl,
        details: { limitBytes: GOOGLEBOT_HTML_LIMIT_BYTES, elements },
      });
    }
  }

  // 1c. Next.js flight data (the RSC payload the App Router streams for hydration) as a share of the page.
  if (htmlSize > 500 * KB) {
    let rscBytes = 0;
    for (const match of html.matchAll(RSC_SCRIPT)) rscBytes += Buffer.byteLength(match[0], 'utf-8');
    const share = rscBytes / htmlSize;
    if (share > 0.5) {
      findings.push({
        code: 'HTML_RSC_PAYLOAD_HEAVY',
        severity: 'info',
        category: 'performance',
        message: `Next.js flight data (self.__next_f.push scripts) is ${Math.round(share * 100)}% of the ${(htmlSize / KB).toFixed(0)} KB HTML`,
        explanation:
          'The flight payload is what the App Router streams for hydration. A large share means little indexable content per byte, and it pushes <body> content towards the 2 MB Googlebot reads of an HTML file.',
        suggestion:
          'Pass fewer and smaller props to client components, fetch data on the client where it is not indexable content, or render the route statically.',
        url: normalizedUrl,
        details: { totalBytes: htmlSize, rscBytes, share: Math.round(share * 100) / 100 },
      });
    }
  }

  // 2. Render-blocking scripts in <head>: external classic scripts without async or defer.
  // Inline scripts have nothing to download, and data blocks (ld+json, importmap,
  // speculationrules, any non-JavaScript type) are never executed, so none of them qualify.
  // Nor do nomodule scripts: every browser that supports modules, Googlebot included, skips them.
  const blocking = getHeadScripts(html)
    .filter((s) => s.src && !s.async && !s.defer && !s.noModule && isClassicScript(s.type))
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
