import * as cheerio from 'cheerio';

export function getCanonicalUrl(html: string): string | null {
  const $ = cheerio.load(html);
  const href = $('link[rel="canonical"]').attr('href');
  return href?.trim() || null;
}

export function getNoindexDirective(html: string): boolean {
  const $ = cheerio.load(html);
  const robotsMeta = $('meta[name="robots"]').attr('content') ?? '';
  const googlebotMeta = $('meta[name="googlebot"]').attr('content') ?? '';
  const combined = `${robotsMeta} ${googlebotMeta}`.toLowerCase();
  return combined.includes('noindex');
}

export function getMetaRefresh(html: string): string | null {
  const $ = cheerio.load(html);
  const content = $('meta[http-equiv="refresh"]').attr('content');
  if (!content) return null;

  const match = content.match(/url\s*=\s*['"]?([^'";\s]+)/i);
  return match?.[1] ?? null;
}

export function getMetaTag(html: string, name: string): string | null {
  const $ = cheerio.load(html);
  // Check both name and property attributes (for OG tags)
  const value =
    $(`meta[name="${name}"]`).attr('content') ??
    $(`meta[property="${name}"]`).attr('content');
  return value?.trim() || null;
}

export function getCharset(html: string): string | null {
  const $ = cheerio.load(html);
  const charset = $('meta[charset]').attr('charset');
  if (charset) return charset;

  const httpEquiv = $('meta[http-equiv="Content-Type"]').attr('content');
  if (httpEquiv) {
    const match = httpEquiv.match(/charset=([^\s;]+)/i);
    return match?.[1] ?? null;
  }
  return null;
}

export function getViewport(html: string): string | null {
  const $ = cheerio.load(html);
  return $('meta[name="viewport"]').attr('content')?.trim() || null;
}

export function getTitle(html: string): string | null {
  const $ = cheerio.load(html);
  return $('title').first().text().trim() || null;
}

export interface FaviconLink {
  rel: string;
  href: string;
  type?: string;
  sizes?: string;
}

export function getFaviconLinks(html: string): FaviconLink[] {
  const $ = cheerio.load(html);
  const links: FaviconLink[] = [];

  $('link[rel*="icon"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      links.push({
        rel: $(el).attr('rel') ?? 'icon',
        href,
        type: $(el).attr('type') ?? undefined,
        sizes: $(el).attr('sizes') ?? undefined,
      });
    }
  });

  return links;
}
