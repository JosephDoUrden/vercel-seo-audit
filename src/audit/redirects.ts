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

// How far the audited URL moved: `none` when only the scheme or a trailing
// slash changed (HTTP_NO_HTTPS_REDIRECT and TRAILING_SLASH_REDIRECT cover those),
// `www` when the host only gained or lost `www.`, `elsewhere` for anything else.
function targetMove(from: string, to: string): 'none' | 'www' | 'elsewhere' {
  const a = new URL(from);
  const b = new URL(to);
  const rest = (u: URL) => `${u.port}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  if (rest(a) !== rest(b)) return 'elsewhere';
  if (a.hostname === b.hostname) return 'none';
  const bare = (host: string) => host.replace(/^www\./, '');
  return bare(a.hostname) === bare(b.hostname) ? 'www' : 'elsewhere';
}

export async function auditRedirects(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const { normalizedUrl, fetchOptions } = ctx;

  // 1. Redirect chain of the audited page
  const chain = await followRedirectChain(normalizedUrl, fetchOptions);

  if (chain.isCircular) {
    findings.push({
      code: 'REDIRECT_LOOP',
      severity: 'error',
      category: 'redirect',
      message: 'Redirect loop detected on the audited page',
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

  // 1b. The audited URL itself lands somewhere else, so every page check
  // describes the destination rather than the URL that was asked for.
  if (!chain.isCircular && chain.hops.length > 0) {
    const move = targetMove(normalizedUrl, chain.finalUrl);
    if (move !== 'none') {
      findings.push({
        code: 'TARGET_REDIRECTED',
        severity: move === 'www' ? 'info' : 'warning',
        category: 'redirect',
        message: `The audited URL redirects to ${chain.finalUrl}`,
        explanation:
          'Search Console reports a URL like this as "Page with redirect" and does not index it. The checks below describe the destination, not the URL you asked for.',
        suggestion:
          'Audit the destination URL directly. If the redirect is unintended, fix it in next.config.js redirects, middleware or vercel.json.',
        details: { from: normalizedUrl, to: chain.finalUrl, hops: chain.hops, status: chain.hops[0].status },
        url: normalizedUrl,
      });
    }
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
    const location = slashRes.headers.get('location');
    const slashTarget = location ? new URL(location, testUrl).href : undefined;
    // A probe that lands where the audited URL already redirected is the same
    // redirect seen again, and TARGET_REDIRECTED has reported it.
    const reobserved =
      slashTarget !== undefined &&
      chain.hops.length > 0 &&
      (slashTarget === chain.finalUrl || chain.hops.some((hop) => hop.location === slashTarget));
    if (slashRes.status >= 300 && slashRes.status < 400 && !reobserved) {
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
    const html = ctx.html ?? (await fetchPage(normalizedUrl, fetchOptions)).body;
    const metaRefreshUrl = getMetaRefresh(html);

    if (metaRefreshUrl) {
      findings.push({
        code: 'META_REFRESH_REDIRECT',
        severity: 'warning',
        category: 'redirect',
        message: 'Meta refresh redirect detected on the audited page',
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
