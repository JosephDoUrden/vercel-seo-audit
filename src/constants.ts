export const DEFAULT_TIMEOUT = 10_000;
export const MAX_REDIRECTS = 20;
// Bodies are read up to these many bytes and the rest is dropped, so a huge or endless
// response cannot exhaust memory. Pages (and anything else) stop at 10 MiB, five times
// the 2 MB Googlebot reads of an HTML file; the page is parsed by a dozen modules, so a
// bigger cap costs gigabytes. Sitemaps stop at Google's limit for an uncompressed
// sitemap, 50 MB (50,000,000 bytes).
export const MAX_HTML_BYTES = 10 * 1024 * 1024;
export const MAX_SITEMAP_BYTES = 50_000_000;
// Googlebot reads the first 2 MB of an HTML file, counted on the uncompressed data, and
// indexes only that part (developers.google.com/search/docs/crawling-indexing/googlebot,
// last updated 03 Feb 2026).
export const GOOGLEBOT_HTML_LIMIT_BYTES = 2 * 1024 * 1024;
export const VERSION = '2.15.0'; // x-release-please-version
export const USER_AGENT = 'vercel-seo-audit/2.15.0'; // x-release-please-version
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

// AI crawler user-agent tokens, by what a block in robots.txt opts the site out of. Read 31 Oct 2026:
// - Anthropic, https://support.claude.com/en/articles/8896518 (updated 07 Apr 2026): ClaudeBot collects
//   content that "may be used for model training", Claude-SearchBot works "to improve search result
//   quality for users", and "Claude-User supports Claude AI users".
// - OpenAI, https://developers.openai.com/api/docs/bots (undated): "Disallowing GPTBot indicates a site's
//   content should not be used in training generative AI foundation models", "OAI-SearchBot is used to
//   surface websites in search results in ChatGPT's search features", and for ChatGPT-User "Because these
//   actions are initiated by a user, robots.txt rules may not apply."
// - Google, https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers (updated
//   30 Oct 2026): Google-Extended is a "standalone product token" for whether content is used "for training
//   future generations of Gemini models", and it "does not impact a site's inclusion in Google Search".
// - Apple, https://support.apple.com/en-us/119829 (published 04 Sep 2026): "With Applebot-Extended, web
//   publishers can choose to opt out of their website content being used to train Apple's general purpose
//   foundation models", and "Webpages that disallow Applebot-Extended can still be included in search results."
// - Common Crawl, https://commoncrawl.org/ccbot (undated): CCBot, blocked with "User-agent: CCBot".
//   Its archive is a common source of training data, hence the training column.
// - Perplexity, https://docs.perplexity.ai/guides/bots (undated): PerplexityBot is "designed to surface and
//   link websites in search results on Perplexity", and Perplexity-User "generally ignores robots.txt rules".
export const AI_CRAWLERS = {
  training: ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot'],
  search: ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'],
  user: ['ChatGPT-User', 'Claude-User', 'Perplexity-User'],
} as const;

export const DEFAULT_PATHS = {
  robotsTxt: '/robots.txt',
  sitemapXml: '/sitemap.xml',
  faviconIco: '/favicon.ico',
} as const;
