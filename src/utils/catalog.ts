import { ISSUE_CODES, ISSUE_DESCRIPTIONS, MODULE_IDS } from '../types.js';
import type { IssueCategory, IssueCode, ModuleId } from '../types.js';

/** `target` is the up-front fetch of the audited page, before any module runs. */
export type FindingSource = ModuleId | 'target';

// Which module reports each code, and under which category. A code can come
// from more than one place (EDGE_CHALLENGE, RESPONSE_TOO_LARGE). MODULE_FAILED
// is left out: any module can report it, under that module's category.
// catalog.test.ts checks this against the finding literals in the sources.
const SOURCES: readonly (readonly [FindingSource, IssueCategory, readonly IssueCode[]])[] = [
  ['target', 'indexing', ['TARGET_UNREACHABLE', 'TARGET_HTTP_ERROR', 'TARGET_NOT_HTML']],
  ['target', 'performance', ['RESPONSE_TOO_LARGE']],
  ['robots', 'robots', [
    'ROBOTS_MISSING', 'ROBOTS_BLOCKS_ALL', 'ROBOTS_BLOCKS_GOOGLEBOT', 'ROBOTS_NO_SITEMAP', 'ROBOTS_SERVER_ERROR',
    'ROBOTS_TOO_LARGE', 'ROBOTS_BLOCKS_RENDER_ASSETS', 'ROBOTS_BLOCKS_NEXT_IMAGE', 'EDGE_CHALLENGE',
    'AI_CRAWLER_ACCESS', 'AI_SEARCH_BOT_BLOCKED',
  ]],
  ['redirects', 'redirect', [
    'REDIRECT_CHAIN', 'REDIRECT_LOOP', 'HTTP_TO_HTTPS_REDIRECT', 'HTTP_NO_HTTPS_REDIRECT', 'TRAILING_SLASH_REDIRECT',
    'META_REFRESH_REDIRECT', 'COMMON_PAGE_REDIRECT', 'TARGET_REDIRECTED',
  ]],
  ['sitemap', 'sitemap', [
    'SITEMAP_MISSING', 'SITEMAP_REDIRECTED', 'SITEMAP_EMPTY', 'SITEMAP_INVALID_URL', 'SITEMAP_URL_ERROR',
    'SITEMAP_ROBOTS_MISMATCH', 'SITEMAP_CROSS_HOST_URLS', 'SITEMAP_MALFORMED_XML', 'SITEMAP_TOO_MANY_URLS',
    'SITEMAP_RELATIVE_URLS', 'SITEMAP_LASTMOD_INVALID', 'SITEMAP_LASTMOD_IDENTICAL', 'SITEMAP_IGNORED_FIELDS',
    'SITEMAP_INDEX_NESTED', 'EDGE_CHALLENGE', 'RESPONSE_TOO_LARGE', 'SITEMAP_FOUND',
  ]],
  ['metadata', 'indexing', ['NOINDEX_DETECTED', 'X_ROBOTS_NOINDEX', 'CANONICAL_NOINDEX_CONFLICT']],
  ['metadata', 'metadata', [
    'CANONICAL_MISSING', 'CANONICAL_MISMATCH', 'CANONICAL_EXTERNAL', 'CHARSET_MISSING', 'VIEWPORT_MISSING',
    'TITLE_MISSING', 'DESCRIPTION_MISSING', 'OG_TITLE_MISSING', 'OG_DESCRIPTION_MISSING', 'OG_IMAGE_MISSING',
    'OG_IMAGE_BROKEN', 'OG_IMAGE_RELATIVE', 'TWITTER_CARD_MISSING', 'TWITTER_IMAGE_MISSING', 'TWITTER_IMAGE_BROKEN',
    'CANONICAL_MULTIPLE', 'CANONICAL_IN_BODY', 'CANONICAL_HEADER_CONFLICT', 'CANONICAL_RELATIVE', 'CANONICAL_TARGET_NOT_OK',
  ]],
  ['favicon', 'favicon', ['FAVICON_MISSING', 'FAVICON_CONFLICT', 'FAVICON_HTML_MISSING']],
  ['nextjs', 'nextjs', ['VERCEL_DETECTED', 'NEXTJS_TRAILING_SLASH_308', 'MIDDLEWARE_REDIRECT', 'APP_ROUTER_METADATA']],
  ['structuredData', 'structured-data', [
    'JSONLD_MISSING', 'JSONLD_INVALID_JSON', 'JSONLD_MISSING_CONTEXT', 'JSONLD_MISSING_TYPE', 'JSONLD_EMPTY_FIELDS',
    'JSONLD_FOUND',
  ]],
  ['i18n', 'i18n', [
    'HREFLANG_MISSING', 'HREFLANG_INVALID_LANG', 'HREFLANG_MISSING_SELF', 'HREFLANG_MISSING_XDEFAULT',
    'HREFLANG_MISSING_RECIPROCAL', 'HREFLANG_DUPLICATE',
  ]],
  ['images', 'images', [
    'IMG_MISSING_ALT', 'IMG_EMPTY_ALT', 'IMG_NO_NEXT_IMAGE', 'IMG_NO_LAZY_LOADING', 'IMG_LARGE_FILE',
    'IMG_MISSING_DIMENSIONS',
  ]],
  ['security', 'security', ['HSTS_MISSING', 'CONTENT_TYPE_OPTIONS_MISSING', 'FRAME_PROTECTION_MISSING', 'REFERRER_POLICY_MISSING']],
  ['performance', 'performance', ['HTML_SIZE_WARNING', 'RENDER_BLOCKING_SCRIPT', 'LARGE_INLINE_STYLE', 'MISSING_PRECONNECT',
    'HTML_PAST_GOOGLEBOT_LIMIT', 'HTML_RSC_PAYLOAD_HEAVY',
  ]],
  ['vercel', 'vercel', [
    'NOT_ON_VERCEL', 'VERCEL_CACHE_MISS', 'VERCEL_CACHE_STALE', 'VERCEL_CACHE_BYPASS', 'VERCEL_CACHE_CONTROL_MISSING',
    'VERCEL_S_MAXAGE_SHORT', 'VERCEL_SWR_MISSING', 'VERCEL_PREVIEW_INDEXABLE', 'EDGE_CHALLENGE',
  ]],
  ['streamedMetadata', 'nextjs', ['METADATA_STREAMED_TO_BODY', 'METADATA_NOT_IN_HEAD', 'METADATA_IN_HEAD']],
  ['hostLeak', 'metadata', ['URL_HOST_LOCALHOST', 'URL_HOST_VERCEL_APP', 'URL_HOST_MISMATCH']],
  ['uaParity', 'indexing', ['UA_STATUS_DIFFERS', 'UA_METADATA_DIFFERS', 'UA_CACHE_DIFFERS', 'UA_SIZE_DIFFERS']],
  ['soft404', 'indexing', [
    'SOFT_404', 'SOFT_404_NOINDEX', 'SOFT_404_REDIRECT', 'SOFT_404_SERVER_ERROR', 'SOFT_404_NONE', 'NEXTJS_ERROR_SHELL',
  ]],
  ['crawl', 'crawl', [
    'CRAWL_PAGE_ERROR', 'CRAWL_PAGE_NOINDEX', 'CRAWL_PAGE_TITLE_MISSING', 'CRAWL_PAGE_DESCRIPTION_MISSING',
    'CRAWL_PAGE_CANONICAL_MISSING', 'CRAWL_PAGE_CANONICAL_MISMATCH', 'CRAWL_PAGE_JSONLD_MISSING', 'RESPONSE_TOO_LARGE',
    'CRAWL_PAGE_HREFLANG_MISSING_SELF', 'CRAWL_PAGE_IMAGES_MISSING_ALT', 'CRAWL_PAGE_OG_MISSING',
    'CRAWL_PAGE_METADATA_IN_BODY', 'CRAWL_PAGE_CANONICAL_MULTIPLE', 'CRAWL_PAGE_CANONICAL_RELATIVE',
    'CRAWL_DUPLICATE_TITLES', 'CRAWL_DUPLICATE_DESCRIPTIONS', 'CRAWL_CANONICAL_CHAIN',
  ]],
];

export interface CodeEntry {
  code: IssueCode;
  /** Where the finding comes from, in run order; every module for MODULE_FAILED. */
  modules: FindingSource[];
  /** The categories it is filed under; empty for MODULE_FAILED, which takes the failing module's. */
  categories: IssueCategory[];
  description: string;
}

/** Every source and category for one code, in the order the audit runs. */
export function describeCode(code: IssueCode): CodeEntry {
  const rows = SOURCES.filter(([, , codes]) => codes.includes(code));
  return {
    code,
    modules: code === 'MODULE_FAILED' ? [...MODULE_IDS] : [...new Set(rows.map(([source]) => source))],
    categories: [...new Set(rows.map(([, category]) => category))],
    description: ISSUE_DESCRIPTIONS[code],
  };
}

/** The (source, category, code) rows of the table, for the test that checks it against the sources. */
export function sourceRows(): [FindingSource, IssueCategory, IssueCode][] {
  return SOURCES.flatMap(([source, category, codes]) => codes.map((code): [FindingSource, IssueCategory, IssueCode] => [source, category, code]));
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** The `count` known codes nearest to `input` by edit distance; ties keep ISSUE_CODES order. */
export function closestCodes(input: string, count = 3): IssueCode[] {
  const needle = input.toUpperCase();
  return ISSUE_CODES
    .map((code, index) => ({ code, index, distance: levenshtein(needle, code) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, count)
    .map((c) => c.code);
}

/**
 * The text `vercel-seo-audit explain <CODE>` prints, or an error line naming the
 * three closest codes. The code is matched case-insensitively, `-` read as `_`.
 */
export function explain(input: string): { ok: true; text: string } | { ok: false; error: string } {
  const code = input.trim().toUpperCase().replace(/-/g, '_');
  if (!(ISSUE_CODES as readonly string[]).includes(code)) {
    return { ok: false, error: `Error: unknown code "${input}" (closest: ${closestCodes(code).join(', ')})` };
  }
  const entry = describeCode(code as IssueCode);
  const category = entry.categories.length > 0 ? entry.categories.join(', ') : "the failing module's";
  return {
    ok: true,
    text: [
      entry.code,
      `module:   ${entry.modules.join(', ')}`,
      `category: ${category}`,
      '',
      entry.description,
    ].join('\n'),
  };
}
