export const DEFAULT_TIMEOUT = 10_000;
export const MAX_REDIRECTS = 20;
export const USER_AGENT = 'vercel-seo-audit/0.2.0';
export const SITEMAP_SAMPLE_SIZE = 10;

export const COMMON_PAGES = ['/about', '/contact', '/blog', '/pricing'];

export const DEFAULT_PATHS = {
  robotsTxt: '/robots.txt',
  sitemapXml: '/sitemap.xml',
  faviconIco: '/favicon.ico',
} as const;
