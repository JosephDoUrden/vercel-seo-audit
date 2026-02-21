export interface SeoAuditConfig {
  url?: string;
  strict?: boolean;
  verbose?: boolean;
  userAgent?: string;
  pages?: string[];
  report?: string;
  timeout?: number;
}

export type IssueSeverity = 'error' | 'warning' | 'info' | 'pass';

export type IssueCategory =
  | 'redirect'
  | 'indexing'
  | 'metadata'
  | 'favicon'
  | 'sitemap'
  | 'robots'
  | 'nextjs'
  | 'structured-data'
  | 'crawl'
  | 'i18n'
  | 'images'
  | 'security'
  | 'performance';

export type IssueCode =
  // Redirect issues
  | 'REDIRECT_CHAIN'
  | 'REDIRECT_LOOP'
  | 'HTTP_TO_HTTPS_REDIRECT'
  | 'HTTP_NO_HTTPS_REDIRECT'
  | 'TRAILING_SLASH_REDIRECT'
  | 'META_REFRESH_REDIRECT'
  | 'COMMON_PAGE_REDIRECT'
  // Indexing issues
  | 'NOINDEX_DETECTED'
  | 'X_ROBOTS_NOINDEX'
  // Metadata issues
  | 'CANONICAL_MISSING'
  | 'CANONICAL_MISMATCH'
  | 'CANONICAL_EXTERNAL'
  | 'CHARSET_MISSING'
  | 'VIEWPORT_MISSING'
  | 'TITLE_MISSING'
  | 'DESCRIPTION_MISSING'
  | 'OG_TITLE_MISSING'
  | 'OG_DESCRIPTION_MISSING'
  | 'OG_IMAGE_MISSING'
  | 'OG_IMAGE_BROKEN'
  | 'OG_IMAGE_RELATIVE'
  | 'TWITTER_CARD_MISSING'
  | 'TWITTER_IMAGE_MISSING'
  | 'TWITTER_IMAGE_BROKEN'
  // Favicon issues
  | 'FAVICON_MISSING'
  | 'FAVICON_CONFLICT'
  | 'FAVICON_HTML_MISSING'
  // Sitemap issues
  | 'SITEMAP_MISSING'
  | 'SITEMAP_REDIRECTED'
  | 'SITEMAP_EMPTY'
  | 'SITEMAP_INVALID_URL'
  | 'SITEMAP_URL_ERROR'
  | 'SITEMAP_ROBOTS_MISMATCH'
  // Robots issues
  | 'ROBOTS_MISSING'
  | 'ROBOTS_BLOCKS_ALL'
  | 'ROBOTS_BLOCKS_GOOGLEBOT'
  | 'ROBOTS_NO_SITEMAP'
  // Next.js / Vercel issues
  | 'VERCEL_DETECTED'
  | 'NEXTJS_TRAILING_SLASH_308'
  | 'MIDDLEWARE_REDIRECT'
  | 'APP_ROUTER_METADATA'
  // Structured data issues
  | 'JSONLD_MISSING'
  | 'JSONLD_INVALID_JSON'
  | 'JSONLD_MISSING_CONTEXT'
  | 'JSONLD_MISSING_TYPE'
  | 'JSONLD_EMPTY_FIELDS'
  // Crawl issues
  | 'CRAWL_PAGE_ERROR'
  | 'CRAWL_PAGE_NOINDEX'
  | 'CRAWL_PAGE_TITLE_MISSING'
  | 'CRAWL_PAGE_DESCRIPTION_MISSING'
  | 'CRAWL_PAGE_CANONICAL_MISSING'
  | 'CRAWL_PAGE_CANONICAL_MISMATCH'
  | 'CRAWL_PAGE_JSONLD_MISSING'
  // i18n / hreflang issues
  | 'HREFLANG_MISSING'
  | 'HREFLANG_INVALID_LANG'
  | 'HREFLANG_MISSING_SELF'
  | 'HREFLANG_MISSING_XDEFAULT'
  | 'HREFLANG_MISSING_RECIPROCAL'
  | 'HREFLANG_DUPLICATE'
  // Image issues
  | 'IMG_MISSING_ALT'
  | 'IMG_EMPTY_ALT'
  | 'IMG_NO_NEXT_IMAGE'
  | 'IMG_NO_LAZY_LOADING'
  | 'IMG_LARGE_FILE'
  | 'IMG_MISSING_DIMENSIONS'
  // Security header issues
  | 'HSTS_MISSING'
  | 'CONTENT_TYPE_OPTIONS_MISSING'
  | 'FRAME_PROTECTION_MISSING'
  | 'REFERRER_POLICY_MISSING'
  // Performance issues
  | 'HTML_SIZE_WARNING'
  | 'RENDER_BLOCKING_SCRIPT'
  | 'LARGE_INLINE_STYLE'
  | 'MISSING_PRECONNECT';

export interface AuditFinding {
  code: IssueCode;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  explanation: string;
  suggestion: string;
  details?: Record<string, unknown>;
  url?: string;
}

export interface AuditModuleResult {
  module: string;
  findings: AuditFinding[];
}

export interface AuditReport {
  url: string;
  timestamp: string;
  duration: number;
  summary: {
    errors: number;
    warnings: number;
    info: number;
    passed: number;
  };
  modules: AuditModuleResult[];
}

export interface DiffResult {
  newIssues: AuditFinding[];
  resolvedIssues: AuditFinding[];
  unchanged: AuditFinding[];
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface RedirectChain {
  hops: RedirectHop[];
  finalUrl: string;
  isCircular: boolean;
}

export interface FetchOptions {
  timeout?: number;
  userAgent?: string;
}

export interface AuditContext {
  url: string;
  normalizedUrl: string;
  fetchOptions: FetchOptions;
  verbose: boolean;
  robotsTxt?: string;
  html?: string;
  headers?: Record<string, string>;
  pages?: string[];
  sitemapUrls?: string[];
  crawlLimit?: number;
}
