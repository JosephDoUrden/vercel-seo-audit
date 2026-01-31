import type { AuditContext, AuditFinding } from '../types.js';
import { DEFAULT_PATHS } from '../constants.js';
import { fetchHead, fetchPage } from '../utils/http.js';
import { getFaviconLinks } from '../utils/html-parser.js';
import { getOrigin } from '../utils/url.js';

export async function auditFavicon(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const origin = getOrigin(ctx.normalizedUrl);
  const faviconUrl = `${origin}${DEFAULT_PATHS.faviconIco}`;

  // 1. Check /favicon.ico directly
  let faviconIcoExists = false;
  try {
    const { status } = await fetchHead(faviconUrl, ctx.fetchOptions);
    faviconIcoExists = status === 200;
  } catch {
    // Ignore fetch errors
  }

  // 2. Check HTML link tags for favicons
  let html = ctx.html;
  if (!html) {
    try {
      const page = await fetchPage(ctx.normalizedUrl, ctx.fetchOptions);
      html = page.body;
    } catch {
      return findings;
    }
  }

  const htmlFavicons = getFaviconLinks(html);
  const hasHtmlFavicon = htmlFavicons.length > 0;

  // 3. Report findings
  if (!faviconIcoExists && !hasHtmlFavicon) {
    findings.push({
      code: 'FAVICON_MISSING',
      severity: 'warning',
      category: 'favicon',
      message: 'No favicon found',
      explanation:
        'A missing favicon causes 404 errors in server logs and looks unprofessional in browser tabs and bookmarks.',
      suggestion:
        'Add a favicon.ico at the root of your site or declare one via <link rel="icon"> in your HTML.',
      url: faviconUrl,
    });
  } else if (!hasHtmlFavicon && faviconIcoExists) {
    findings.push({
      code: 'FAVICON_HTML_MISSING',
      severity: 'info',
      category: 'favicon',
      message: 'Favicon exists at /favicon.ico but no HTML link tag declares it',
      explanation:
        'While browsers will find /favicon.ico by convention, explicitly declaring it in HTML ensures compatibility and allows specifying multiple sizes.',
      suggestion: 'Add <link rel="icon" href="/favicon.ico"> to your HTML <head>.',
      url: faviconUrl,
    });
  } else if (hasHtmlFavicon && faviconIcoExists) {
    // Check for potential conflicts
    const icoLinks = htmlFavicons.filter(
      (f) => f.href.endsWith('.ico') || f.href.includes('favicon.ico'),
    );
    const nonIcoLinks = htmlFavicons.filter(
      (f) => !f.href.endsWith('.ico') && !f.href.includes('favicon.ico'),
    );

    if (icoLinks.length > 0 && nonIcoLinks.length > 0) {
      findings.push({
        code: 'FAVICON_CONFLICT',
        severity: 'info',
        category: 'favicon',
        message: `Multiple favicon formats declared (${htmlFavicons.length} links)`,
        explanation:
          'Multiple favicon declarations are normal for supporting different devices, but verify they all resolve.',
        suggestion: 'Ensure all declared favicon URLs are accessible.',
        details: { favicons: htmlFavicons },
        url: ctx.normalizedUrl,
      });
    }
  }

  return findings;
}
