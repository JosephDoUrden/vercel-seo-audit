export const DEFAULT_TIMEOUT = 10_000;
export const MAX_REDIRECTS = 20;
export const USER_AGENT = 'vercel-seo-audit/2.7.0'; // x-release-please-version
export const SITEMAP_SAMPLE_SIZE = 10;

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

export const DEFAULT_PATHS = {
  robotsTxt: '/robots.txt',
  sitemapXml: '/sitemap.xml',
  faviconIco: '/favicon.ico',
} as const;
