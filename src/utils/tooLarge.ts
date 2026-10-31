import { MAX_HTML_BYTES, MAX_SITEMAP_BYTES } from '../constants.js';
import type { AuditFinding, IssueCategory } from '../types.js';

/**
 * The finding for a body that fetchPage cut at its cap: MAX_SITEMAP_BYTES for a
 * sitemap, MAX_HTML_BYTES for anything else. `details.bytes` is the size the server
 * declared in `content-length`, or `null` when it sent none.
 */
export function responseTooLarge(
  url: string,
  category: IssueCategory,
  headers: Headers,
  kind: 'html' | 'sitemap' = 'html',
): AuditFinding {
  const declared = Number.parseInt(headers.get('content-length') ?? '', 10);
  const sitemap = kind === 'sitemap';
  const limit = sitemap ? MAX_SITEMAP_BYTES : MAX_HTML_BYTES;
  return {
    code: 'RESPONSE_TOO_LARGE',
    severity: 'warning',
    category,
    ...(sitemap
      ? {
          message: `Sitemap is larger than 50 MB and was cut there: ${url}`,
          explanation:
            'Google ignores a sitemap over 50 MB (50,000,000 bytes) uncompressed. Only the first 50 MB were read, so the checks saw part of it.',
          suggestion: 'Split the sitemap into several behind a sitemap index, each under 50 MB and 50,000 URLs.',
        }
      : {
          // https://developers.google.com/search/docs/crawling-indexing/googlebot (updated 03 Feb 2026)
          message: `Page is larger than 10 MiB and was cut there: ${url}`,
          explanation:
            'Googlebot reads only the first 2 MB of an HTML file and indexes what came before the cut-off. Only the first 10 MiB were read here, so the checks saw part of the page.',
          suggestion: 'Make the HTML smaller: move inline data, styles and scripts out of the page, and paginate long lists.',
        }),
    details: { bytes: Number.isNaN(declared) ? null : declared, limit },
    url,
  };
}
