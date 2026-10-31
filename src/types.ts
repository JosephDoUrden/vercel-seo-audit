export interface SeoAuditConfig {
  url?: string;
  strict?: boolean;
  verbose?: boolean;
  userAgent?: string;
  pages?: string[];
  report?: 'json' | 'md' | 'html';
  timeout?: number;
  ignore?: string[];
  only?: string[];
  format?: OutputFormat;
}

/** `text` is the human report; `agent` is the compact JSON contract for coding agents. */
export type OutputFormat = 'text' | 'agent';

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
  | 'performance'
  | 'vercel';

export const ISSUE_CODES = [
  // Redirect issues
  'REDIRECT_CHAIN',
  'REDIRECT_LOOP',
  'HTTP_TO_HTTPS_REDIRECT',
  'HTTP_NO_HTTPS_REDIRECT',
  'TRAILING_SLASH_REDIRECT',
  'META_REFRESH_REDIRECT',
  'COMMON_PAGE_REDIRECT',
  'TARGET_REDIRECTED',
  // Target issues: the audited page itself
  'TARGET_UNREACHABLE',
  'TARGET_HTTP_ERROR',
  'TARGET_NOT_HTML',
  // An audit module that threw instead of returning findings
  'MODULE_FAILED',
  // A response cut at MAX_HTML_BYTES or MAX_SITEMAP_BYTES (the audited page, a sitemap or a crawled page)
  'RESPONSE_TOO_LARGE',
  // Indexing issues
  'NOINDEX_DETECTED',
  'X_ROBOTS_NOINDEX',
  // Metadata issues
  'CANONICAL_MISSING',
  'CANONICAL_MISMATCH',
  'CANONICAL_EXTERNAL',
  'CHARSET_MISSING',
  'VIEWPORT_MISSING',
  'TITLE_MISSING',
  'DESCRIPTION_MISSING',
  'OG_TITLE_MISSING',
  'OG_DESCRIPTION_MISSING',
  'OG_IMAGE_MISSING',
  'OG_IMAGE_BROKEN',
  'OG_IMAGE_RELATIVE',
  'TWITTER_CARD_MISSING',
  'TWITTER_IMAGE_MISSING',
  'TWITTER_IMAGE_BROKEN',
  // Favicon issues
  'FAVICON_MISSING',
  'FAVICON_CONFLICT',
  'FAVICON_HTML_MISSING',
  // Sitemap issues
  'SITEMAP_MISSING',
  'SITEMAP_REDIRECTED',
  'SITEMAP_EMPTY',
  'SITEMAP_INVALID_URL',
  'SITEMAP_URL_ERROR',
  'SITEMAP_ROBOTS_MISMATCH',
  'SITEMAP_CROSS_HOST_URLS',
  'SITEMAP_MALFORMED_XML',
  'SITEMAP_TOO_MANY_URLS',
  'SITEMAP_RELATIVE_URLS',
  'SITEMAP_LASTMOD_INVALID',
  'SITEMAP_LASTMOD_IDENTICAL',
  'SITEMAP_IGNORED_FIELDS',
  'SITEMAP_INDEX_NESTED',
  // Robots issues
  'ROBOTS_MISSING',
  'ROBOTS_BLOCKS_ALL',
  'ROBOTS_BLOCKS_GOOGLEBOT',
  'ROBOTS_NO_SITEMAP',
  'ROBOTS_SERVER_ERROR',
  'ROBOTS_TOO_LARGE',
  // Next.js / Vercel issues
  'VERCEL_DETECTED',
  'NEXTJS_TRAILING_SLASH_308',
  'MIDDLEWARE_REDIRECT',
  'APP_ROUTER_METADATA',
  'METADATA_STREAMED_TO_BODY',
  'METADATA_NOT_IN_HEAD',
  'METADATA_IN_HEAD',
  // Structured data issues
  'JSONLD_MISSING',
  'JSONLD_INVALID_JSON',
  'JSONLD_MISSING_CONTEXT',
  'JSONLD_MISSING_TYPE',
  'JSONLD_EMPTY_FIELDS',
  // Crawl issues
  'CRAWL_PAGE_ERROR',
  'CRAWL_PAGE_NOINDEX',
  'CRAWL_PAGE_TITLE_MISSING',
  'CRAWL_PAGE_DESCRIPTION_MISSING',
  'CRAWL_PAGE_CANONICAL_MISSING',
  'CRAWL_PAGE_CANONICAL_MISMATCH',
  'CRAWL_PAGE_JSONLD_MISSING',
  // i18n / hreflang issues
  'HREFLANG_MISSING',
  'HREFLANG_INVALID_LANG',
  'HREFLANG_MISSING_SELF',
  'HREFLANG_MISSING_XDEFAULT',
  'HREFLANG_MISSING_RECIPROCAL',
  'HREFLANG_DUPLICATE',
  // Image issues
  'IMG_MISSING_ALT',
  'IMG_EMPTY_ALT',
  'IMG_NO_NEXT_IMAGE',
  'IMG_NO_LAZY_LOADING',
  'IMG_LARGE_FILE',
  'IMG_MISSING_DIMENSIONS',
  // Security header issues
  'HSTS_MISSING',
  'CONTENT_TYPE_OPTIONS_MISSING',
  'FRAME_PROTECTION_MISSING',
  'REFERRER_POLICY_MISSING',
  // Performance issues
  'HTML_SIZE_WARNING',
  'RENDER_BLOCKING_SCRIPT',
  'LARGE_INLINE_STYLE',
  'MISSING_PRECONNECT',
  'HTML_PAST_GOOGLEBOT_LIMIT',
  'HTML_RSC_PAYLOAD_HEAVY',
  // Vercel platform issues
  'NOT_ON_VERCEL',
  'VERCEL_CACHE_MISS',
  'VERCEL_CACHE_STALE',
  'VERCEL_CACHE_BYPASS',
  'VERCEL_CACHE_CONTROL_MISSING',
  'VERCEL_S_MAXAGE_SHORT',
  'VERCEL_SWR_MISSING',
  'VERCEL_PREVIEW_INDEXABLE',
  // Edge challenge or WAF block, on the page, robots.txt or the sitemap
  'EDGE_CHALLENGE',
  // robots.txt rules that block what the page loads
  'ROBOTS_BLOCKS_RENDER_ASSETS',
  'ROBOTS_BLOCKS_NEXT_IMAGE',
  // Page URLs that point at a host other than the audited site
  'URL_HOST_LOCALHOST',
  'URL_HOST_VERCEL_APP',
  'URL_HOST_MISMATCH',
  // The canonical as Google reads it: placement, count, the Link header and the target
  'CANONICAL_MULTIPLE',
  'CANONICAL_IN_BODY',
  'CANONICAL_HEADER_CONFLICT',
  'CANONICAL_RELATIVE',
  'CANONICAL_TARGET_NOT_OK',
  'CANONICAL_NOINDEX_CONFLICT',
  // Which AI crawlers robots.txt lets in
  'AI_CRAWLER_ACCESS',
  'AI_SEARCH_BOT_BLOCKED',
  // What the page serves to different crawler user agents
  'UA_STATUS_DIFFERS',
  'UA_METADATA_DIFFERS',
  'UA_CACHE_DIFFERS',
  'UA_SIZE_DIFFERS',
  // What the site answers for a path that does not exist
  'SOFT_404',
  'SOFT_404_NOINDEX',
  'SOFT_404_REDIRECT',
  'SOFT_404_SERVER_ERROR',
  'SOFT_404_NONE',
  'NEXTJS_ERROR_SHELL',
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

/** One sentence per code saying what the finding means; `vercel-seo-audit explain <CODE>` prints it. */
export const ISSUE_DESCRIPTIONS: Record<IssueCode, string> = {
  REDIRECT_CHAIN: 'The audited URL goes through more than one redirect before it answers, which costs crawl budget on every visit.',
  REDIRECT_LOOP: 'The audited URL redirects back to itself, so neither a browser nor a crawler ever reaches the page.',
  HTTP_TO_HTTPS_REDIRECT: 'The http:// version of the site redirects to https://, which is what it should do.',
  HTTP_NO_HTTPS_REDIRECT: 'The http:// version of the site answers without redirecting to https://, so two copies of every page can be indexed.',
  TRAILING_SLASH_REDIRECT: 'Adding or removing the trailing slash on the audited URL causes a redirect, so links in the other form cost an extra hop.',
  META_REFRESH_REDIRECT: 'The page redirects with a <meta http-equiv="refresh"> tag instead of an HTTP redirect, which search engines treat less reliably.',
  COMMON_PAGE_REDIRECT: 'One of the common paths or the --pages paths goes through a chain of redirects before it answers.',
  TARGET_REDIRECTED: 'The audited URL redirects to a different host or path, so the page checks describe the destination rather than the URL given.',
  TARGET_UNREACHABLE: 'The audited URL could not be fetched at all (DNS, TLS, connection or timeout), so nothing else was audited.',
  TARGET_HTTP_ERROR: 'The audited URL answered with a 4xx or 5xx status, and search engines drop such pages from the index.',
  TARGET_NOT_HTML: 'The audited URL did not return HTML, or returned an empty body, so the checks that read the page as HTML were skipped.',
  MODULE_FAILED: 'An audit module threw before it could report, so its checks are missing from the report.',
  RESPONSE_TOO_LARGE: 'A response (the page, a sitemap or a crawled page) was over the read limit and was cut, so the checks saw only part of it.',
  NOINDEX_DETECTED: 'The page carries a robots meta noindex, so search engines will drop it from the index.',
  X_ROBOTS_NOINDEX: 'The response carries an X-Robots-Tag: noindex header, so search engines will drop the page from the index.',
  CANONICAL_MISSING: 'The page has no <link rel="canonical">, so search engines pick the canonical URL themselves.',
  CANONICAL_MISMATCH: 'The canonical URL differs from the audited page\'s URL, which asks search engines to index that one instead.',
  CANONICAL_EXTERNAL: 'The canonical URL points at another domain, which hands the page\'s ranking to that domain.',
  CHARSET_MISSING: 'The page declares no character set, so its text can be decoded wrongly.',
  VIEWPORT_MISSING: 'The page has no viewport meta tag, so phones render it as a desktop page.',
  TITLE_MISSING: 'The page has no <title>, so search results show a title the search engine made up.',
  DESCRIPTION_MISSING: 'The page has no meta description, so search results show a snippet the search engine picked.',
  OG_TITLE_MISSING: 'The page has no og:title, so link previews on social sites fall back to guesses.',
  OG_DESCRIPTION_MISSING: 'The page has no og:description, so link previews on social sites carry no summary.',
  OG_IMAGE_MISSING: 'The page has no og:image, so link previews on social sites show no image.',
  OG_IMAGE_BROKEN: 'The og:image URL does not load, so link previews show no image.',
  OG_IMAGE_RELATIVE: 'The og:image URL is relative, and most social crawlers need an absolute one.',
  TWITTER_CARD_MISSING: 'The page has no twitter:card, so X shows a plain link instead of a card.',
  TWITTER_IMAGE_MISSING: 'The page has no twitter:image, so the X card shows no image.',
  TWITTER_IMAGE_BROKEN: 'The twitter:image URL does not load, so the X card shows no image.',
  FAVICON_MISSING: 'No favicon was found at /favicon.ico or in the page\'s <link> tags, so search results show a generic icon.',
  FAVICON_CONFLICT: 'The page declares several favicon formats, so browsers and search engines may pick an unexpected one.',
  FAVICON_HTML_MISSING: 'A /favicon.ico exists but no <link rel="icon"> in the page declares it.',
  SITEMAP_MISSING: 'No usable sitemap was found (missing, unreachable or invalid XML), so crawlers find pages only through links.',
  SITEMAP_REDIRECTED: 'The sitemap URL redirects, and crawlers may not follow it.',
  SITEMAP_EMPTY: 'The sitemap parses but lists no URLs.',
  SITEMAP_INVALID_URL: 'Reserved for a sitemap entry that is not a valid URL; the current version never reports it.',
  SITEMAP_URL_ERROR: 'A sampled URL from the sitemap answers with an error status, so the sitemap advertises a broken page.',
  SITEMAP_ROBOTS_MISMATCH: 'The Sitemap directive in robots.txt points somewhere other than /sitemap.xml.',
  SITEMAP_CROSS_HOST_URLS: 'The sitemap lists URLs on another host, which search engines accept only from a verified host, and the audit did not check them.',
  ROBOTS_MISSING: 'No robots.txt was found, so crawlers get no rules and no pointer to the sitemap.',
  ROBOTS_BLOCKS_ALL: 'robots.txt disallows the whole site for every crawler.',
  ROBOTS_BLOCKS_GOOGLEBOT: 'robots.txt disallows the whole site for Googlebot or another named search crawler.',
  ROBOTS_NO_SITEMAP: 'robots.txt has no Sitemap directive, so crawlers have to guess where the sitemap is.',
  ROBOTS_SERVER_ERROR: 'robots.txt answers with a 5xx status, and Google pauses crawling the whole site while it does.',
  ROBOTS_TOO_LARGE: 'robots.txt is over Google\'s 500 KiB limit, and rules past the limit are ignored.',
  VERCEL_DETECTED: 'The site is served by Vercel, and by Next.js when the message says so, so the Vercel and Next.js checks apply.',
  NEXTJS_TRAILING_SLASH_308: 'Next.js answers the other trailing-slash form of the URL with a 308, so links in that form cost a redirect.',
  MIDDLEWARE_REDIRECT: 'Next.js middleware rewrote or redirected the request, which can send crawlers somewhere other than the page.',
  APP_ROUTER_METADATA: 'The response looks like Next.js but the usual build markers are missing from the HTML.',
  METADATA_STREAMED_TO_BODY: 'Next.js 15.2+ streamed the page metadata into <body> for this user agent, so crawlers that read only <head> see none of it.',
  METADATA_NOT_IN_HEAD: 'The page metadata is not in <head> even for an HTML-limited bot, so crawlers that read only <head> see none of it.',
  METADATA_IN_HEAD: 'The page metadata is in <head> for the default user agent, which is what it should be.',
  JSONLD_MISSING: 'The page has no JSON-LD structured data, so it is not eligible for rich results.',
  JSONLD_INVALID_JSON: 'A JSON-LD block does not parse as JSON, so search engines ignore it.',
  JSONLD_MISSING_CONTEXT: 'A JSON-LD block has no @context, so search engines cannot tell which vocabulary it uses.',
  JSONLD_MISSING_TYPE: 'A JSON-LD block or @graph node has no @type, so search engines cannot tell what it describes.',
  JSONLD_EMPTY_FIELDS: 'A JSON-LD node is missing fields its type needs for rich results.',
  CRAWL_PAGE_ERROR: 'A page from the sitemap could not be fetched, or answered with an error status, during --crawl.',
  CRAWL_PAGE_NOINDEX: 'A page from the sitemap carries a noindex meta tag or header, so the sitemap advertises a page that asks not to be indexed.',
  CRAWL_PAGE_TITLE_MISSING: 'A page from the sitemap has no <title>.',
  CRAWL_PAGE_DESCRIPTION_MISSING: 'A page from the sitemap has no meta description.',
  CRAWL_PAGE_CANONICAL_MISSING: 'A page from the sitemap has no canonical tag.',
  CRAWL_PAGE_CANONICAL_MISMATCH: 'A page from the sitemap has a canonical URL that differs from its own URL.',
  CRAWL_PAGE_JSONLD_MISSING: 'A page from the sitemap has no JSON-LD structured data.',
  HREFLANG_MISSING: 'The page has no hreflang tags, which matters only when the site has other language versions.',
  HREFLANG_INVALID_LANG: 'An hreflang value is not a valid language or language-region code, so search engines ignore it.',
  HREFLANG_MISSING_SELF: 'The hreflang set does not include the page itself, which search engines expect.',
  HREFLANG_MISSING_XDEFAULT: 'The hreflang set has no x-default entry for visitors who match none of the languages.',
  HREFLANG_MISSING_RECIPROCAL: 'An alternate-language page does not link back to this page, so search engines may ignore the pair.',
  HREFLANG_DUPLICATE: 'The same hreflang value appears more than once, so search engines cannot tell which URL is meant.',
  IMG_MISSING_ALT: 'Images have no alt attribute, so image search and screen readers get no description.',
  IMG_EMPTY_ALT: 'Images have an empty alt attribute, which is right only for decorative images.',
  IMG_NO_NEXT_IMAGE: 'Images are plain <img> tags rather than next/image, so they miss its resizing and lazy loading.',
  IMG_NO_LAZY_LOADING: 'Images below the fold load eagerly, which slows the first render.',
  IMG_LARGE_FILE: 'Images are over 200 KB each, which slows the page.',
  IMG_MISSING_DIMENSIONS: 'Images have no width and height, so the layout shifts as they load.',
  HSTS_MISSING: 'The response has no Strict-Transport-Security header, so browsers may still try http:// first.',
  CONTENT_TYPE_OPTIONS_MISSING: 'The response has no X-Content-Type-Options: nosniff header.',
  FRAME_PROTECTION_MISSING: 'The response has neither X-Frame-Options nor a CSP frame-ancestors rule, so other sites can frame the page.',
  REFERRER_POLICY_MISSING: 'The response has no Referrer-Policy header, so the browser default decides what is sent to other sites.',
  HTML_SIZE_WARNING: 'The HTML document is over 500 KB, which slows the page and can push content past what crawlers read.',
  RENDER_BLOCKING_SCRIPT: 'Scripts in <head> have neither async nor defer, so they block the first render.',
  LARGE_INLINE_STYLE: 'An inline <style> block is over 50 KB, which bloats every HTML response.',
  MISSING_PRECONNECT: 'The page loads from third-party origins without a <link rel="preconnect"> for them.',
  HTML_PAST_GOOGLEBOT_LIMIT: 'The title, meta description, canonical, robots meta, first JSON-LD block or <h1> starts past the first 2 MB of the HTML, which Googlebot does not read.',
  HTML_RSC_PAYLOAD_HEAVY: 'Next.js flight data (self.__next_f.push scripts) is over half of an HTML document larger than 500 KB.',
  NOT_ON_VERCEL: 'No Vercel signal was found in the response headers, so the Vercel checks were skipped.',
  VERCEL_CACHE_MISS: 'The Vercel CDN did not serve the page from its cache (x-vercel-cache: MISS).',
  VERCEL_CACHE_STALE: 'The Vercel CDN served a stale copy while it refreshed the page (x-vercel-cache: STALE).',
  VERCEL_CACHE_BYPASS: 'The Vercel CDN skipped its cache for this request (x-vercel-cache: BYPASS).',
  VERCEL_CACHE_CONTROL_MISSING: 'The response gives the Vercel CDN no cache lifetime, so the page is rendered on every request.',
  VERCEL_S_MAXAGE_SHORT: 'The CDN cache lifetime (s-maxage) is under 60 seconds, so the page is rendered again often.',
  VERCEL_SWR_MISSING: 'The CDN cache lifetime is set without stale-while-revalidate, so visitors wait for each refresh.',
  VERCEL_PREVIEW_INDEXABLE: 'A *.vercel.app URL is served without noindex, so a preview deployment can be indexed next to production.',
  EDGE_CHALLENGE: 'Vercel or Cloudflare served a JavaScript challenge instead of the page, robots.txt or the sitemap, so a crawler that does not run JavaScript gets no content.',
  ROBOTS_BLOCKS_RENDER_ASSETS: 'robots.txt blocks Googlebot from scripts or stylesheets the page loads, so Google cannot render it as visitors see it.',
  ROBOTS_BLOCKS_NEXT_IMAGE: 'robots.txt blocks /_next/image, which the page\'s images load through, so they drop out of image search.',
  URL_HOST_LOCALHOST: 'The canonical, social card, hreflang or JSON-LD URLs on the page point at localhost or a local network name, so crawlers and link previews follow a dead host.',
  URL_HOST_VERCEL_APP: 'The canonical, social card, hreflang or JSON-LD URLs on the page point at a *.vercel.app host instead of the audited domain, which splits signals between the two.',
  URL_HOST_MISMATCH: 'og:url points at a different host from the audited page.',
  CANONICAL_MULTIPLE: 'The page has several canonical tags naming different URLs, so Google ignores all of them.',
  CANONICAL_IN_BODY: 'The canonical tag is in <body>, where Google does not accept it.',
  CANONICAL_HEADER_CONFLICT: 'The Link: rel="canonical" header and the canonical tag name different URLs, so Google may ignore both.',
  CANONICAL_RELATIVE: 'The canonical URL is relative or carries a fragment, and Google wants a full absolute URL.',
  CANONICAL_TARGET_NOT_OK: 'The canonical URL does not answer with a plain 200, so it points search engines at a page they will not index.',
  CANONICAL_NOINDEX_CONFLICT: 'The page is noindex and also names another URL as canonical, two signals that contradict each other.',
  SITEMAP_MALFORMED_XML: 'The sitemap is not well-formed XML, so Google cannot read it.',
  SITEMAP_TOO_MANY_URLS: 'The sitemap lists more than 50,000 URLs, over Google\'s limit for one file.',
  SITEMAP_RELATIVE_URLS: 'Some sitemap <loc> values are not absolute URLs, and Google skips them.',
  SITEMAP_LASTMOD_INVALID: 'Some <lastmod> values are not W3C Datetime, so Google ignores them.',
  SITEMAP_LASTMOD_IDENTICAL: 'Every <lastmod> in the sitemap is the same timestamp, so Google learns nothing from them.',
  SITEMAP_IGNORED_FIELDS: 'The sitemap sets <priority> or <changefreq>, which Google ignores.',
  SITEMAP_INDEX_NESTED: 'A sitemap index lists other sitemap index files, which Google does not follow.',
  AI_CRAWLER_ACCESS: 'Which AI training, search and user-fetch crawlers robots.txt lets fetch the site root.',
  AI_SEARCH_BOT_BLOCKED: 'robots.txt blocks an AI search crawler while it allows Googlebot, so the site drops out of AI search answers.',
  UA_STATUS_DIFFERS: 'The audited page answers 2xx to the default user agent but a 4xx or 5xx to Googlebot, an HTML-limited bot or another crawler.',
  UA_METADATA_DIFFERS: 'The title, canonical or robots directives change with the user agent, a bug and a cloaking risk.',
  UA_CACHE_DIFFERS: 'Some user agents get a private or no-store cache-control and others do not, as Next.js 16.3 does for htmlLimitedBots.',
  UA_SIZE_DIFFERS: 'The page is more than 30% bigger or smaller for one user agent than for another.',
  SOFT_404: 'A path that does not exist answers 200 without noindex, which Google reports as a soft 404.',
  SOFT_404_NOINDEX: 'A path that does not exist answers 200 with noindex, what Next.js does when notFound() runs after streaming has started.',
  SOFT_404_REDIRECT: 'A path that does not exist redirects to another page, which Google treats as a soft 404.',
  SOFT_404_SERVER_ERROR: 'A path that does not exist makes the server answer 5xx instead of 404.',
  SOFT_404_NONE: 'Paths that do not exist answer 404 or 410, which is what they should do.',
  NEXTJS_ERROR_SHELL: 'A path that does not exist answers 200 with the empty Next.js error document, which has no title or content.',
};

export interface AuditFinding {
  code: IssueCode;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  explanation: string;
  suggestion: string;
  details?: Record<string, unknown>;
  url?: string;
  /** Set when the finding's code is on the ignore list; such findings are left out of the summary counts. */
  ignored?: boolean;
}

export interface FixSuggestion {
  code: IssueCode;
  filePath: string;
  description: string;
  content: string;
}

/** Audit module ids, in the order they run. These are the names in `report.modules[].module`. */
export const MODULE_IDS = [
  'robots',
  'redirects',
  'sitemap',
  'metadata',
  'favicon',
  'nextjs',
  'structuredData',
  'i18n',
  'images',
  'security',
  'performance',
  'vercel',
  'streamedMetadata',
  'hostLeak',
  'uaParity',
  'soft404',
  'crawl',
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

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
    /** Findings left out of the counts above because their code is ignored. */
    ignored?: number;
  };
  modules: AuditModuleResult[];
  /** The modules that ran when the audit was limited with `--only`, dependencies included. Absent on a full run. */
  only?: ModuleId[];
  /**
   * The audited page as the up-front fetch saw it. Always set by `runAudit`; optional only so
   * reports saved by older versions still load for `--diff`.
   */
  page?: PageFacts;
}

export interface PageFacts {
  /** HTTP status of the final response, after redirects; `null` when the request failed. */
  status: number | null;
  /** URL of the final response, after redirects; `null` when the request failed. */
  finalUrl: string | null;
  /** Whether the response looks like Next.js (x-powered-by header or build markers in the HTML). */
  nextjs: boolean;
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

// In-flight and settled responses keyed by method and URL, shared by every
// module of one audit so the same URL is never requested twice.
export type FetchCache = Map<string, Promise<unknown>>;

export interface FetchOptions {
  timeout?: number;
  userAgent?: string;
  cache?: FetchCache;
  /** Bytes of body to read before cutting it; MAX_HTML_BYTES when unset. */
  maxBytes?: number;
  /**
   * The URL being audited. When it is public, no request goes to a private address,
   * start URL or redirect hop alike. Unset, each call is judged by its own start URL.
   */
  auditedUrl?: string;
}

export interface AuditContext {
  url: string;
  normalizedUrl: string;
  fetchOptions: FetchOptions;
  verbose: boolean;
  robotsTxt?: string;
  html?: string;
  headers?: Record<string, string>;
  finalUrl?: string;
  pages?: string[];
  sitemapUrls?: string[];
  crawlLimit?: number;
}
