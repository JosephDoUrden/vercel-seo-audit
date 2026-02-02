export type IssueSeverity = "error" | "warning" | "info" | "pass";

export type IssueCategory =
  | "redirect"
  | "indexing"
  | "metadata"
  | "favicon"
  | "sitemap"
  | "robots"
  | "nextjs";

export type IssueCode =
  // Redirect issues
  | "REDIRECT_CHAIN"
  | "REDIRECT_LOOP"
  | "HTTP_TO_HTTPS_REDIRECT"
  | "HTTP_NO_HTTPS_REDIRECT"
  | "TRAILING_SLASH_REDIRECT"
  | "META_REFRESH_REDIRECT"
  | "COMMON_PAGE_REDIRECT"
  // Indexing issues
  | "NOINDEX_DETECTED"
  | "X_ROBOTS_NOINDEX"
  // Metadata issues
  | "CANONICAL_MISSING"
  | "CANONICAL_MISMATCH"
  | "CANONICAL_EXTERNAL"
  | "CHARSET_MISSING"
  | "VIEWPORT_MISSING"
  | "TITLE_MISSING"
  | "DESCRIPTION_MISSING"
  | "OG_TITLE_MISSING"
  | "OG_DESCRIPTION_MISSING"
  | "OG_IMAGE_MISSING"
  // Favicon issues
  | "FAVICON_MISSING"
  | "FAVICON_CONFLICT"
  | "FAVICON_HTML_MISSING"
  // Sitemap issues
  | "SITEMAP_MISSING"
  | "SITEMAP_REDIRECTED"
  | "SITEMAP_EMPTY"
  | "SITEMAP_INVALID_URL"
  | "SITEMAP_URL_ERROR"
  | "SITEMAP_ROBOTS_MISMATCH"
  // Robots issues
  | "ROBOTS_MISSING"
  | "ROBOTS_BLOCKS_ALL"
  | "ROBOTS_BLOCKS_GOOGLEBOT"
  | "ROBOTS_NO_SITEMAP"
  // Next.js / Vercel issues
  | "VERCEL_DETECTED"
  | "NEXTJS_TRAILING_SLASH_308"
  | "MIDDLEWARE_REDIRECT"
  | "APP_ROUTER_METADATA";

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
  strict: boolean;
  robotsTxt?: string;
  html?: string;
  headers?: Record<string, string>;
}
