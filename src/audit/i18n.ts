import type { AuditContext, AuditFinding } from '../types.js';
import { fetchPage } from '../utils/http.js';
import { getHreflangLinks } from '../utils/html-parser.js';

const LANG_CODE_RE = /^[a-z]{2}(-[a-z]{2})?$/;
const MAX_RECIPROCAL_CHECKS = 10;

function normalizeForComparison(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash for comparison (unless it's just the root)
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

export async function auditI18n(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const { normalizedUrl, fetchOptions } = ctx;

  let html: string;

  if (ctx.html) {
    html = ctx.html;
  } else {
    try {
      const page = await fetchPage(normalizedUrl, fetchOptions);
      html = page.body;
      ctx.html = html;
      ctx.headers = Object.fromEntries(page.headers.entries());
    } catch {
      return findings;
    }
  }

  const links = getHreflangLinks(html);

  if (links.length === 0) {
    findings.push({
      code: 'HREFLANG_MISSING',
      severity: 'info',
      category: 'i18n',
      message: 'No hreflang tags found',
      explanation:
        'Hreflang tags tell search engines which language/region a page targets. If your site is single-language, this is expected.',
      suggestion:
        'If your site has multiple language versions, add <link rel="alternate" hreflang="..."> tags.',
      url: normalizedUrl,
    });
    return findings;
  }

  // Validate language codes
  for (const link of links) {
    if (link.hreflang !== 'x-default' && !LANG_CODE_RE.test(link.hreflang)) {
      findings.push({
        code: 'HREFLANG_INVALID_LANG',
        severity: 'error',
        category: 'i18n',
        message: `Invalid hreflang value: "${link.hreflang}"`,
        explanation:
          'Hreflang values must be a valid ISO 639-1 language code (e.g. "en") optionally followed by an ISO 3166-1 region code (e.g. "en-us"), or "x-default".',
        suggestion:
          `Change "${link.hreflang}" to a valid language code like "en", "en-us", or "x-default".`,
        details: { hreflang: link.hreflang, href: link.href },
        url: normalizedUrl,
      });
    }
  }

  // Check self-reference
  const currentNormalized = normalizeForComparison(normalizedUrl);
  const hasSelfRef = links.some(
    (link) => normalizeForComparison(link.href) === currentNormalized,
  );
  if (!hasSelfRef) {
    findings.push({
      code: 'HREFLANG_MISSING_SELF',
      severity: 'warning',
      category: 'i18n',
      message: 'Hreflang tags do not include a self-referencing entry',
      explanation:
        'Every page with hreflang tags should include a link pointing to itself. Without it, search engines may ignore all hreflang annotations on this page.',
      suggestion:
        'Add a <link rel="alternate" hreflang="..."> tag whose href matches this page\'s URL.',
      url: normalizedUrl,
    });
  }

  // Check x-default
  const hasXDefault = links.some((link) => link.hreflang === 'x-default');
  if (!hasXDefault) {
    findings.push({
      code: 'HREFLANG_MISSING_XDEFAULT',
      severity: 'warning',
      category: 'i18n',
      message: 'No x-default hreflang tag found',
      explanation:
        'The x-default hreflang value specifies a fallback page for users whose language doesn\'t match any listed variant.',
      suggestion:
        'Add <link rel="alternate" hreflang="x-default" href="..."> pointing to your default language page.',
      url: normalizedUrl,
    });
  }

  // Check duplicates
  const seen = new Set<string>();
  for (const link of links) {
    if (seen.has(link.hreflang)) {
      findings.push({
        code: 'HREFLANG_DUPLICATE',
        severity: 'warning',
        category: 'i18n',
        message: `Duplicate hreflang value: "${link.hreflang}"`,
        explanation:
          'Each hreflang value should appear only once per page. Duplicates confuse search engines about which URL to serve.',
        suggestion:
          `Remove the duplicate hreflang="${link.hreflang}" entry, keeping only one.`,
        details: { hreflang: link.hreflang, href: link.href },
        url: normalizedUrl,
      });
    }
    seen.add(link.hreflang);
  }

  // Check reciprocal links
  const alternates = links.filter(
    (link) =>
      link.hreflang !== 'x-default' &&
      normalizeForComparison(link.href) !== currentNormalized,
  );

  const toCheck = alternates.slice(0, MAX_RECIPROCAL_CHECKS);

  for (const alt of toCheck) {
    try {
      const page = await fetchPage(alt.href, fetchOptions);
      const remoteLinks = getHreflangLinks(page.body);
      const linksBack = remoteLinks.some(
        (remote) => normalizeForComparison(remote.href) === currentNormalized,
      );
      if (!linksBack) {
        findings.push({
          code: 'HREFLANG_MISSING_RECIPROCAL',
          severity: 'error',
          category: 'i18n',
          message: `Alternate page "${alt.href}" does not link back to this page`,
          explanation:
            'Hreflang annotations must be reciprocal — if page A links to page B, page B must link back to page A. Without reciprocal links, search engines may ignore the hreflang.',
          suggestion:
            `Add a <link rel="alternate" hreflang="..." href="${normalizedUrl}"> tag on ${alt.href}.`,
          details: { hreflang: alt.hreflang, href: alt.href },
          url: normalizedUrl,
        });
      }
    } catch {
      // Skip pages that can't be fetched
    }
  }

  return findings;
}
