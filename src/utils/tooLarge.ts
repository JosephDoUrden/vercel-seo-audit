import { MAX_BODY_BYTES } from '../constants.js';
import type { AuditFinding, IssueCategory } from '../types.js';

/**
 * The finding for a body that fetchPage cut at MAX_BODY_BYTES. `details.bytes`
 * is the size the server declared in `content-length`, or `null` when it sent none.
 */
export function responseTooLarge(url: string, category: IssueCategory, headers: Headers): AuditFinding {
  const declared = Number.parseInt(headers.get('content-length') ?? '', 10);
  const mib = MAX_BODY_BYTES / (1024 * 1024);
  return {
    code: 'RESPONSE_TOO_LARGE',
    severity: 'warning',
    category,
    message: `Response is larger than ${mib} MiB and was cut there: ${url}`,
    explanation:
      `Only the first ${mib} MiB were read, so checks on this response saw part of it. Search engines stop reading far earlier: Google ignores sitemaps over 50 MB uncompressed.`,
    suggestion: 'Make the response smaller; split a large sitemap into several behind a sitemap index.',
    details: { bytes: Number.isNaN(declared) ? null : declared, limit: MAX_BODY_BYTES },
    url,
  };
}
