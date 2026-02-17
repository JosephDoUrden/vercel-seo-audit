import { describe, it, expect } from 'vitest';
import { parseSitemapXml } from './xml-parser.js';

describe('parseSitemapXml', () => {
  it('parses urlset with multiple URLs', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/</loc><lastmod>2024-01-01</lastmod></url>
        <url><loc>https://example.com/about</loc></url>
      </urlset>`;
    const result = parseSitemapXml(xml);
    expect(result.type).toBe('urlset');
    expect(result.urls).toHaveLength(2);
    expect(result.urls[0].loc).toBe('https://example.com/');
    expect(result.urls[0].lastmod).toBe('2024-01-01');
    expect(result.urls[1].loc).toBe('https://example.com/about');
    expect(result.urls[1].lastmod).toBeUndefined();
    expect(result.sitemaps).toHaveLength(0);
  });

  it('parses sitemapindex', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>
        <sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap>
      </sitemapindex>`;
    const result = parseSitemapXml(xml);
    expect(result.type).toBe('sitemapindex');
    expect(result.sitemaps).toEqual([
      'https://example.com/sitemap-1.xml',
      'https://example.com/sitemap-2.xml',
    ]);
    expect(result.urls).toHaveLength(0);
  });

  it('handles empty urlset', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      </urlset>`;
    const result = parseSitemapXml(xml);
    expect(result.type).toBe('urlset');
    expect(result.urls).toHaveLength(0);
  });

  it('handles single URL in urlset', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/</loc></url>
      </urlset>`;
    const result = parseSitemapXml(xml);
    expect(result.urls).toHaveLength(1);
    expect(result.urls[0].loc).toBe('https://example.com/');
  });

  it('returns empty result for unknown root element', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><root></root>`;
    const result = parseSitemapXml(xml);
    expect(result.type).toBe('urlset');
    expect(result.urls).toHaveLength(0);
    expect(result.sitemaps).toHaveLength(0);
  });

  it('parses optional fields (changefreq, priority)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url>
          <loc>https://example.com/</loc>
          <changefreq>daily</changefreq>
          <priority>1.0</priority>
        </url>
      </urlset>`;
    const result = parseSitemapXml(xml);
    expect(result.urls[0].changefreq).toBe('daily');
    expect(result.urls[0].priority).toBe('1');
  });

  it('handles single sitemap in sitemapindex', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>
      </sitemapindex>`;
    const result = parseSitemapXml(xml);
    expect(result.type).toBe('sitemapindex');
    expect(result.sitemaps).toHaveLength(1);
  });

  it('skips URL entries without loc', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><lastmod>2024-01-01</lastmod></url>
        <url><loc>https://example.com/valid</loc></url>
      </urlset>`;
    const result = parseSitemapXml(xml);
    expect(result.urls).toHaveLength(1);
    expect(result.urls[0].loc).toBe('https://example.com/valid');
  });

  it('converts numeric loc to string', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>12345</loc></url>
      </urlset>`;
    const result = parseSitemapXml(xml);
    expect(result.urls[0].loc).toBe('12345');
    expect(typeof result.urls[0].loc).toBe('string');
  });
});
