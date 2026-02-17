import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditCrawl } from './crawl.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
}));

import { fetchPage } from '../utils/http.js';

const mockFetchPage = vi.mocked(fetchPage);

function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: {},
    verbose: false,
    ...overrides,
  };
}

function makePage(html: string, status = 200): { body: string; status: number; headers: Headers; finalUrl: string } {
  return {
    body: html,
    status,
    headers: new Headers(),
    finalUrl: 'https://example.com/',
  };
}

const GOOD_HTML = `<html><head>
  <title>Test Page</title>
  <meta name="description" content="A test page">
  <link rel="canonical" href="https://example.com/page-1">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
</head><body></body></html>`;

const BAD_HTML = '<html><head></head><body></body></html>';

beforeEach(() => {
  mockFetchPage.mockReset();
  // Suppress stderr output in tests
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

describe('auditCrawl', () => {
  it('returns empty findings when sitemapUrls is undefined', async () => {
    const ctx = makeCtx();
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(0);
  });

  it('returns empty findings when sitemapUrls is empty', async () => {
    const ctx = makeCtx({ sitemapUrls: [] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(0);
  });

  it('returns no findings for a page with all SEO elements', async () => {
    mockFetchPage.mockResolvedValue(makePage(GOOD_HTML));
    const ctx = makeCtx({
      sitemapUrls: ['https://example.com/page-1'],
    });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(0);
  });

  it('detects all issues on a bare page', async () => {
    mockFetchPage.mockResolvedValue(makePage(BAD_HTML));
    const ctx = makeCtx({
      sitemapUrls: ['https://example.com/page-1'],
    });
    const findings = await auditCrawl(ctx);

    const codes = findings.map((f) => f.code);
    expect(codes).toContain('CRAWL_PAGE_TITLE_MISSING');
    expect(codes).toContain('CRAWL_PAGE_DESCRIPTION_MISSING');
    expect(codes).toContain('CRAWL_PAGE_CANONICAL_MISSING');
    expect(codes).toContain('CRAWL_PAGE_JSONLD_MISSING');
  });

  it('detects noindex meta tag', async () => {
    const html = '<html><head><meta name="robots" content="noindex"><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/p"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({
      sitemapUrls: ['https://example.com/p'],
    });
    const findings = await auditCrawl(ctx);
    expect(findings.some((f) => f.code === 'CRAWL_PAGE_NOINDEX')).toBe(true);
  });

  it('detects X-Robots-Tag noindex header', async () => {
    const headers = new Headers({ 'x-robots-tag': 'noindex' });
    mockFetchPage.mockResolvedValue({
      body: GOOD_HTML,
      status: 200,
      headers,
      finalUrl: 'https://example.com/page-1',
    });
    const ctx = makeCtx({
      sitemapUrls: ['https://example.com/page-1'],
    });
    const findings = await auditCrawl(ctx);
    expect(findings.some((f) => f.code === 'CRAWL_PAGE_NOINDEX')).toBe(true);
  });

  it('detects canonical mismatch', async () => {
    const html = '<html><head><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/other-page"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({
      sitemapUrls: ['https://example.com/page-1'],
    });
    const findings = await auditCrawl(ctx);
    expect(findings.some((f) => f.code === 'CRAWL_PAGE_CANONICAL_MISMATCH')).toBe(true);
  });

  it('reports error for non-2xx status', async () => {
    mockFetchPage.mockResolvedValue(makePage('', 404));
    const ctx = makeCtx({
      sitemapUrls: ['https://example.com/missing'],
    });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_ERROR');
    expect(findings[0].severity).toBe('error');
  });

  it('handles fetch errors gracefully', async () => {
    mockFetchPage.mockRejectedValue(new Error('Network error'));
    const ctx = makeCtx({
      sitemapUrls: ['https://example.com/timeout'],
    });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_ERROR');
  });

  it('respects crawl limit', async () => {
    mockFetchPage.mockResolvedValue(makePage(GOOD_HTML));
    const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/page-${i}`);
    const ctx = makeCtx({
      sitemapUrls: urls,
      crawlLimit: 3,
    });
    await auditCrawl(ctx);
    expect(mockFetchPage).toHaveBeenCalledTimes(3);
  });

  it('uses DEFAULT_CRAWL_LIMIT when crawlLimit is not set', async () => {
    mockFetchPage.mockResolvedValue(makePage(GOOD_HTML));
    const urls = Array.from({ length: 60 }, (_, i) => `https://example.com/page-${i}`);
    const ctx = makeCtx({
      sitemapUrls: urls,
    });
    await auditCrawl(ctx);
    // DEFAULT_CRAWL_LIMIT is 50
    expect(mockFetchPage).toHaveBeenCalledTimes(50);
  });

  it('sets url on all findings', async () => {
    mockFetchPage.mockResolvedValue(makePage(BAD_HTML));
    const ctx = makeCtx({
      sitemapUrls: ['https://example.com/page-1'],
    });
    const findings = await auditCrawl(ctx);
    for (const finding of findings) {
      expect(finding.url).toBe('https://example.com/page-1');
    }
  });

  it('sets category to crawl on all findings', async () => {
    mockFetchPage.mockResolvedValue(makePage(BAD_HTML));
    const ctx = makeCtx({
      sitemapUrls: ['https://example.com/page-1'],
    });
    const findings = await auditCrawl(ctx);
    for (const finding of findings) {
      expect(finding.category).toBe('crawl');
    }
  });
});
