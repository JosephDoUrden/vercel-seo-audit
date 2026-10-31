export const DEFAULT_TIMEOUT = 10_000;
export const MAX_REDIRECTS = 20;
// Bodies are read up to these many bytes and the rest is dropped, so a huge or endless
// response cannot exhaust memory. Pages (and anything else) stop at 10 MiB, five times
// the 2 MB Googlebot reads of an HTML file; the page is parsed by a dozen modules, so a
// bigger cap costs gigabytes. Sitemaps stop at Google's limit for an uncompressed
// sitemap, 50 MB (50,000,000 bytes).
export const MAX_HTML_BYTES = 10 * 1024 * 1024;
export const MAX_SITEMAP_BYTES = 50_000_000;
export const VERSION = '2.11.0'; // x-release-please-version
export const USER_AGENT = 'vercel-seo-audit/2.11.0'; // x-release-please-version
export const SITEMAP_SAMPLE_SIZE = 10;
// "All formats limit a single sitemap to 50MB (uncompressed) or 50,000 URLs."
// https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap, updated 08 Jul 2026.
// The 50 MB half is MAX_SITEMAP_BYTES above.
export const SITEMAP_MAX_URLS = 50_000;

export const COMMON_PAGES = ['/about', '/contact', '/blog', '/pricing'];

export const USER_AGENT_PRESETS: Record<string, string> = {
  googlebot:
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot:
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
};

// User agents Next.js serves blocking metadata in <head> to, because they do not run
// JavaScript. Everyone else, Googlebot included, gets metadata streamed into <body> when
// generateMetadata is dynamic (Next.js 15.2+). Copied verbatim from
// https://github.com/vercel/next.js/blob/canary/packages/next/src/shared/lib/router/utils/html-bots.ts
// on 25 Oct 2026.
export const HTML_LIMITED_BOT_UA_RE =
  /[\w-]-Google|Google-[\w-]|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight/i;

export const DEFAULT_CRAWL_LIMIT = 50;
export const CRAWL_CONCURRENCY = 5;

// "Google enforces a robots.txt file size limit of 500 kibibytes (KiB). Content which is
// after the maximum file size is ignored."
// https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec, updated 23 Oct 2026.
export const ROBOTS_TXT_MAX_BYTES = 500 * 1024;

export const DEFAULT_PATHS = {
  robotsTxt: '/robots.txt',
  sitemapXml: '/sitemap.xml',
  faviconIco: '/favicon.ico',
} as const;
