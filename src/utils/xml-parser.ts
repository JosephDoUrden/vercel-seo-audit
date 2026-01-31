import { XMLParser } from 'fast-xml-parser';

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

export interface SitemapResult {
  type: 'urlset' | 'sitemapindex';
  urls: SitemapUrl[];
  sitemaps: string[];
}

export function parseSitemapXml(xml: string): SitemapResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name) => name === 'url' || name === 'sitemap',
  });

  const parsed = parser.parse(xml);

  // Handle sitemap index
  if (parsed.sitemapindex?.sitemap) {
    const sitemaps: string[] = [];
    const entries = Array.isArray(parsed.sitemapindex.sitemap)
      ? parsed.sitemapindex.sitemap
      : [parsed.sitemapindex.sitemap];

    for (const entry of entries) {
      if (entry.loc) {
        sitemaps.push(String(entry.loc));
      }
    }

    return { type: 'sitemapindex', urls: [], sitemaps };
  }

  // Handle urlset
  if (parsed.urlset?.url) {
    const urls: SitemapUrl[] = [];
    const entries = Array.isArray(parsed.urlset.url)
      ? parsed.urlset.url
      : [parsed.urlset.url];

    for (const entry of entries) {
      if (entry.loc) {
        urls.push({
          loc: String(entry.loc),
          lastmod: entry.lastmod ? String(entry.lastmod) : undefined,
          changefreq: entry.changefreq ? String(entry.changefreq) : undefined,
          priority: entry.priority ? String(entry.priority) : undefined,
        });
      }
    }

    return { type: 'urlset', urls, sitemaps: [] };
  }

  return { type: 'urlset', urls: [], sitemaps: [] };
}
