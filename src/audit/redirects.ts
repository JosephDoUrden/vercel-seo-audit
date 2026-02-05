import type { AuditContext, AuditFinding } from '../types.js';
import { COMMON_PAGES } from '../constants.js';
import {
  followRedirectChain,
  fetchPage,
  fetchWithoutRedirect,
} from '../utils/http.js';
import { getMetaRefresh } from '../utils/html-parser.js';
import {
  toHttpUrl,
  isHttps,
  hasTrailingSlash,
  addTrailingSlash,
  removeTrailingSlash,
  getOrigin,
} from '../utils/url.js';

export async function auditRedirects(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const { normalizedUrl, fetchOptions } = ctx;

  // 1. Homepage redirect chain
  const chain = await followRedirectChain(normalizedUrl, fetchOptions);

  if (chain.isCircular) {
    findings.push({
      code: 'REDIRECT_LOOP',
      severity: 'error',
      category: 'redirect',
      message: 'Redirect loop detected on homepage',
      explanation:
        'A redirect loop prevents search engines and users from reaching your page, causing crawl failures.',
      suggestion: 'Check your server configuration and middleware for circular redirects.',
      details: { hops: chain.hops },
      url: normalizedUrl,
    });
  } else if (chain.hops.length > 1) {
    findings.push({
      code: 'REDIRECT_CHAIN',
      severity: 'warning',
      category: 'redirect',
      message: `Redirect chain with ${chain.hops.length} hops detected`,
      explanation:
        'Long redirect chains slow down page loading and may cause search engines to drop the page from the index.',
      suggestion:
        'Reduce the chain to a single redirect by pointing directly to the final URL.',
      details: { hops: chain.hops, finalUrl: chain.finalUrl },
      url: normalizedUrl,
    });
  }

  // 2. HTTP → HTTPS check
  if (isHttps(normalizedUrl)) {
    try {
      const httpUrl = toHttpUrl(normalizedUrl);
      const httpChain = await followRedirectChain(httpUrl, fetchOptions);
      if (isHttps(httpChain.finalUrl)) {
        findings.push({
          code: 'HTTP_TO_HTTPS_REDIRECT',
          severity: 'pass',
          category: 'redirect',
          message: 'HTTP correctly redirects to HTTPS',
          explanation:
            'HTTP to HTTPS redirects ensure users always reach the secure version of your site.',
          suggestion: 'No action needed.',
          url: httpUrl,
        });
      } else {
        findings.push({
          code: 'HTTP_NO_HTTPS_REDIRECT',
          severity: 'warning',
          category: 'redirect',
          message: 'HTTP does not redirect to HTTPS',
          explanation:
            'Without an HTTP→HTTPS redirect, search engines may index the insecure version of your site.',
          suggestion:
            'Configure your server or Vercel project to redirect HTTP traffic to HTTPS.',
          url: httpUrl,
        });
      }
    } catch {
      // HTTP variant may not exist — not an issue
    }
  }

  // 3. Trailing slash check
  try {
    const withSlash = addTrailingSlash(normalizedUrl);
    const withoutSlash = removeTrailingSlash(normalizedUrl);
    const testUrl = hasTrailingSlash(normalizedUrl) ? withoutSlash : withSlash;

    const slashRes = await fetchWithoutRedirect(testUrl, fetchOptions);
    if (slashRes.status >= 300 && slashRes.status < 400) {
      const status = slashRes.status;
      findings.push({
        code: 'TRAILING_SLASH_REDIRECT',
        severity: status === 308 ? 'info' : 'info',
        category: 'redirect',
        message: `Trailing slash ${hasTrailingSlash(normalizedUrl) ? 'removal' : 'addition'} causes ${status} redirect`,
        explanation:
          'Inconsistent trailing slash handling can create duplicate content issues for search engines.',
        suggestion:
          'Ensure consistent trailing slash behavior across your site. In Next.js, use the trailingSlash config option.',
        details: { testedUrl: testUrl, status },
        url: testUrl,
      });
    }
  } catch {
    // Not critical
  }

  // 4. Meta refresh detection
  try {
    const page = await fetchPage(normalizedUrl, fetchOptions);
    const metaRefreshUrl = getMetaRefresh(page.body);

    if (metaRefreshUrl) {
      findings.push({
        code: 'META_REFRESH_REDIRECT',
        severity: 'warning',
        category: 'redirect',
        message: 'Meta refresh redirect detected on homepage',
        explanation:
          'Meta refresh redirects are slower than server-side redirects and may confuse search engines.',
        suggestion:
          'Replace the meta refresh with a 301 server-side redirect.',
        details: { targetUrl: metaRefreshUrl },
        url: normalizedUrl,
      });
    }
  } catch {
    // Not critical
  }

  // 5. Common page redirect checks
  const origin = getOrigin(normalizedUrl);
  const pagesToCheck = ctx.pages ?? COMMON_PAGES;
  for (const path of pagesToCheck) {
    try {
      const pageUrl = `${origin}${path}`;
      const pageChain = await followRedirectChain(pageUrl, fetchOptions);
      if (pageChain.hops.length > 1) {
        findings.push({
          code: 'COMMON_PAGE_REDIRECT',
          severity: 'info',
          category: 'redirect',
          message: `${path} has a ${pageChain.hops.length}-hop redirect chain`,
          explanation:
            'Redirect chains on commonly linked pages waste crawl budget.',
          suggestion: 'Reduce to a single redirect or update internal links to point to the final URL.',
          details: { hops: pageChain.hops, finalUrl: pageChain.finalUrl },
          url: pageUrl,
        });
      }
    } catch {
      // Page may not exist
    }
  }

  return findings;
}
