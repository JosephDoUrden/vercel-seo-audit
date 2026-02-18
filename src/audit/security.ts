import type { AuditContext, AuditFinding } from '../types.js';
import { fetchHead } from '../utils/http.js';

export async function auditSecurity(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const { normalizedUrl, fetchOptions } = ctx;

  let headers: Record<string, string>;
  if (ctx.headers) {
    headers = ctx.headers;
  } else {
    try {
      const res = await fetchHead(normalizedUrl, fetchOptions);
      headers = Object.fromEntries(res.headers.entries());
    } catch {
      return findings;
    }
  }

  // 1. Strict-Transport-Security
  const hsts = headers['strict-transport-security'];
  if (!hsts) {
    findings.push({
      code: 'HSTS_MISSING',
      severity: 'info',
      category: 'security',
      message: 'Strict-Transport-Security header is missing',
      explanation:
        'HSTS tells browsers to always use HTTPS, preventing protocol downgrade attacks and improving trust signals for search engines.',
      suggestion:
        'Add the Strict-Transport-Security header with a max-age of at least 31536000 (1 year).',
      url: normalizedUrl,
    });
  }

  // 2. X-Content-Type-Options
  const contentTypeOptions = headers['x-content-type-options'];
  if (!contentTypeOptions || contentTypeOptions.toLowerCase() !== 'nosniff') {
    findings.push({
      code: 'CONTENT_TYPE_OPTIONS_MISSING',
      severity: 'info',
      category: 'security',
      message: 'X-Content-Type-Options: nosniff header is missing',
      explanation:
        'Without this header, browsers may MIME-sniff responses, which can lead to mixed-content issues that affect crawling.',
      suggestion: 'Add the header X-Content-Type-Options: nosniff to all responses.',
      url: normalizedUrl,
    });
  }

  // 3. Frame protection (X-Frame-Options or CSP frame-ancestors)
  const xFrameOptions = headers['x-frame-options'];
  const csp = headers['content-security-policy'] ?? '';
  const hasFrameAncestors = csp.toLowerCase().includes('frame-ancestors');
  if (!xFrameOptions && !hasFrameAncestors) {
    findings.push({
      code: 'FRAME_PROTECTION_MISSING',
      severity: 'info',
      category: 'security',
      message: 'No frame protection header found',
      explanation:
        'Without X-Frame-Options or CSP frame-ancestors, your site can be embedded in iframes on other domains, enabling clickjacking.',
      suggestion:
        'Add X-Frame-Options: DENY (or SAMEORIGIN) or use Content-Security-Policy: frame-ancestors \'self\'.',
      url: normalizedUrl,
    });
  }

  // 4. Referrer-Policy
  const referrerPolicy = headers['referrer-policy'];
  if (!referrerPolicy) {
    findings.push({
      code: 'REFERRER_POLICY_MISSING',
      severity: 'info',
      category: 'security',
      message: 'Referrer-Policy header is missing',
      explanation:
        'Without a Referrer-Policy, browsers send the full URL as a referrer, which can leak sensitive query parameters to third parties.',
      suggestion:
        'Add Referrer-Policy: strict-origin-when-cross-origin (or stricter) to control referrer information.',
      url: normalizedUrl,
    });
  }

  return findings;
}
