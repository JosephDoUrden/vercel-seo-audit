import type { AuditContext, AuditFinding } from '../types.js';
import { fetchPage, fetchWithoutRedirect } from '../utils/http.js';
import { addTrailingSlash, removeTrailingSlash, hasTrailingSlash } from '../utils/url.js';

export async function auditNextjs(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const { normalizedUrl, fetchOptions } = ctx;

  // 1. Fetch the page to get headers
  let headers: Record<string, string>;
  try {
    if (ctx.headers) {
      headers = ctx.headers;
    } else {
      const page = await fetchPage(normalizedUrl, fetchOptions);
      headers = Object.fromEntries(page.headers.entries());
    }
  } catch {
    return findings;
  }

  // 2. Vercel detection
  const server = headers['server'] ?? '';
  const xVercelId = headers['x-vercel-id'] ?? '';
  const xPoweredBy = headers['x-powered-by'] ?? '';
  const isVercel = server.toLowerCase().includes('vercel') || !!xVercelId;
  const isNextjs = xPoweredBy.toLowerCase().includes('next.js');

  if (isVercel) {
    findings.push({
      code: 'VERCEL_DETECTED',
      severity: 'info',
      category: 'nextjs',
      message: `Vercel deployment detected${isNextjs ? ' (Next.js)' : ''}`,
      explanation:
        'Vercel-specific optimizations and checks are being applied to this audit.',
      suggestion: 'No action needed. Vercel-specific checks are enabled.',
      details: { server, xVercelId, xPoweredBy },
      url: normalizedUrl,
    });
  }

  // 3. Next.js trailing slash 308 behavior
  try {
    const testUrl = hasTrailingSlash(normalizedUrl)
      ? removeTrailingSlash(normalizedUrl)
      : addTrailingSlash(normalizedUrl);

    const res = await fetchWithoutRedirect(testUrl, fetchOptions);
    if (res.status === 308) {
      findings.push({
        code: 'NEXTJS_TRAILING_SLASH_308',
        severity: 'info',
        category: 'nextjs',
        message: 'Next.js 308 permanent redirect for trailing slash normalization',
        explanation:
          'Next.js uses 308 (Permanent Redirect) to enforce its trailingSlash configuration. This is normal behavior but ensure it matches your intended URL structure.',
        suggestion:
          'If this is unexpected, check next.config.js trailingSlash setting. 308 redirects are cached by browsers.',
        details: {
          testedUrl: testUrl,
          status: 308,
          location: res.headers.get('location'),
        },
        url: testUrl,
      });
    }
  } catch {
    // Not critical
  }

  // 4. Middleware redirect headers
  const xMiddlewareRewrite = headers['x-middleware-rewrite'] ?? '';
  const xMiddlewareRedirect = headers['x-middleware-redirect'] ?? '';
  const xMiddlewareNext = headers['x-middleware-next'] ?? '';

  if (xMiddlewareRewrite || xMiddlewareRedirect) {
    findings.push({
      code: 'MIDDLEWARE_REDIRECT',
      severity: 'info',
      category: 'nextjs',
      message: 'Next.js middleware is modifying the request',
      explanation:
        'Middleware rewrites or redirects can affect how search engines see your pages. Ensure middleware is not unintentionally altering SEO-critical pages.',
      suggestion:
        'Review your middleware.ts to ensure it does not redirect or rewrite SEO-critical URLs.',
      details: {
        rewrite: xMiddlewareRewrite || undefined,
        redirect: xMiddlewareRedirect || undefined,
        next: xMiddlewareNext || undefined,
      },
      url: normalizedUrl,
    });
  }

  // 5. App Router metadata check (presence of Next.js metadata headers)
  const html = ctx.html;
  if (html) {
    const hasNextMetadata =
      html.includes('next-head-count') ||
      html.includes('__next') ||
      html.includes('_next/static');

    if (isNextjs && !hasNextMetadata) {
      findings.push({
        code: 'APP_ROUTER_METADATA',
        severity: 'info',
        category: 'nextjs',
        message: 'Next.js detected but standard Next.js markers not found in HTML',
        explanation:
          'This may indicate a custom rendering setup or edge runtime that could affect metadata generation.',
        suggestion:
          'Ensure your Next.js App Router pages export proper metadata using the Metadata API.',
        url: normalizedUrl,
      });
    }
  }

  return findings;
}
