export const DEFAULT_TIMEOUT = 10_000;
export const MAX_REDIRECTS = 20;
export const USER_AGENT = 'vercel-seo-audit/0.3.0';
export const SITEMAP_SAMPLE_SIZE = 10;

export const COMMON_PAGES = ['/about', '/contact', '/blog', '/pricing'];

export const USER_AGENT_PRESETS: Record<string, string> = {
  googlebot:
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot:
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
};

export const DEFAULT_PATHS = {
  robotsTxt: '/robots.txt',
  sitemapXml: '/sitemap.xml',
  faviconIco: '/favicon.ico',
} as const;
