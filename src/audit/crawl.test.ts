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

function makePage(html: string, opts: { status?: number; headers?: Headers; finalUrl?: string } = {}): {
  body: string;
  status: number;
  headers: Headers;
  finalUrl: string;
} {
  return {
    body: html,
    status: opts.status ?? 200,
    headers: opts.headers ?? new Headers(),
    finalUrl: opts.finalUrl ?? 'https://example.com/',
  };
}

const GOOD_HTML = `<html><head>
  <title>Test Page</title>
  <meta name="description" content="A test page">
  <link rel="canonical" href="https://example.com/page-1">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
</head><body></body></html>`;

const BAD_HTML = '<html><head></head><body></body></html>';

function makeGoodHtml(pageUrl: string): string {
  return `<html><head>
  <title>Test Page</title>
  <meta name="description" content="A test page">
  <link rel="canonical" href="${pageUrl}">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
</head><body></body></html>`;
}

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockFetchPage.mockReset();
  stderrSpy?.mockRestore();
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

describe('auditCrawl', () => {
  // --- Early returns ---

  it('returns empty findings when sitemapUrls is undefined', async () => {
    const ctx = makeCtx();
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(0);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('returns empty findings when sitemapUrls is empty', async () => {
    const ctx = makeCtx({ sitemapUrls: [] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(0);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  // --- Clean page ---

  it('returns no findings for a page with all SEO elements', async () => {
    mockFetchPage.mockResolvedValue(makePage(GOOD_HTML));
    const ctx = makeCtx({
      sitemapUrls: ['https://example.com/page-1'],
    });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(0);
  });

  // --- Individual check detection ---

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
    expect(codes).not.toContain('CRAWL_PAGE_NOINDEX');
    expect(codes).not.toContain('CRAWL_PAGE_ERROR');
  });

  it('detects noindex via meta name="robots"', async () => {
    const html = '<html><head><meta name="robots" content="noindex"><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/p"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/p'] });
    const findings = await auditCrawl(ctx);
    const noindex = findings.filter((f) => f.code === 'CRAWL_PAGE_NOINDEX');
    expect(noindex).toHaveLength(1);
    expect(noindex[0].severity).toBe('warning');
  });

  it('detects noindex via meta name="googlebot"', async () => {
    const html = '<html><head><meta name="googlebot" content="noindex"><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/p"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/p'] });
    const findings = await auditCrawl(ctx);
    expect(findings.some((f) => f.code === 'CRAWL_PAGE_NOINDEX')).toBe(true);
  });

  it('detects X-Robots-Tag noindex header', async () => {
    const headers = new Headers({ 'x-robots-tag': 'noindex' });
    mockFetchPage.mockResolvedValue(makePage(GOOD_HTML, { headers }));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/page-1'] });
    const findings = await auditCrawl(ctx);
    const noindex = findings.filter((f) => f.code === 'CRAWL_PAGE_NOINDEX');
    expect(noindex).toHaveLength(1);
    expect(noindex[0].message).toContain('X-Robots-Tag');
  });

  it('reports two CRAWL_PAGE_NOINDEX when both meta and header have noindex', async () => {
    const html = '<html><head><meta name="robots" content="noindex"><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/p"><script type="application/ld+json">{}</script></head><body></body></html>';
    const headers = new Headers({ 'x-robots-tag': 'noindex' });
    mockFetchPage.mockResolvedValue(makePage(html, { headers }));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/p'] });
    const findings = await auditCrawl(ctx);
    const noindex = findings.filter((f) => f.code === 'CRAWL_PAGE_NOINDEX');
    expect(noindex).toHaveLength(2);
  });

  it('detects missing title only (other elements present)', async () => {
    const html = '<html><head><meta name="description" content="D"><link rel="canonical" href="https://example.com/p"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/p'] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_TITLE_MISSING');
    expect(findings[0].severity).toBe('warning');
  });

  it('detects missing description with correct severity', async () => {
    const html = '<html><head><title>T</title><link rel="canonical" href="https://example.com/p"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/p'] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_DESCRIPTION_MISSING');
    expect(findings[0].severity).toBe('info');
  });

  it('detects missing JSON-LD only with correct severity', async () => {
    const html = '<html><head><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/p"></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/p'] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_JSONLD_MISSING');
    expect(findings[0].severity).toBe('info');
  });

  // --- Canonical checks ---

  it('detects canonical mismatch', async () => {
    const html = '<html><head><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/other-page"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/page-1'] });
    const findings = await auditCrawl(ctx);
    const mismatch = findings.find((f) => f.code === 'CRAWL_PAGE_CANONICAL_MISMATCH');
    expect(mismatch).toBeDefined();
    expect(mismatch!.severity).toBe('warning');
    expect(mismatch!.details).toEqual({
      canonical: 'https://example.com/other-page',
      pageUrl: 'https://example.com/page-1',
    });
  });

  it('accepts canonical with trailing slash difference', async () => {
    const html = '<html><head><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/page-1/"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/page-1'] });
    const findings = await auditCrawl(ctx);
    expect(findings.some((f) => f.code === 'CRAWL_PAGE_CANONICAL_MISMATCH')).toBe(false);
    expect(findings.some((f) => f.code === 'CRAWL_PAGE_CANONICAL_MISSING')).toBe(false);
  });

  it('resolves relative canonical URL against page URL', async () => {
    const html = '<html><head><title>T</title><meta name="description" content="D"><link rel="canonical" href="/page-1"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/page-1'] });
    const findings = await auditCrawl(ctx);
    expect(findings.some((f) => f.code === 'CRAWL_PAGE_CANONICAL_MISMATCH')).toBe(false);
    expect(findings.some((f) => f.code === 'CRAWL_PAGE_CANONICAL_MISSING')).toBe(false);
  });

  // --- Error handling ---

  it('reports error for 404 status', async () => {
    mockFetchPage.mockResolvedValue(makePage('', { status: 404 }));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/missing'] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_ERROR');
    expect(findings[0].severity).toBe('error');
    expect(findings[0].details).toEqual({ status: 404 });
  });

  it('reports error for 500 status', async () => {
    mockFetchPage.mockResolvedValue(makePage('', { status: 500 }));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/broken'] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_ERROR');
    expect(findings[0].message).toContain('500');
  });

  it('reports error for 301 redirect status', async () => {
    mockFetchPage.mockResolvedValue(makePage('', { status: 301 }));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/old'] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_ERROR');
    expect(findings[0].details).toEqual({ status: 301 });
  });

  it('does not run further checks after non-2xx status', async () => {
    mockFetchPage.mockResolvedValue(makePage(BAD_HTML, { status: 404 }));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/missing'] });
    const findings = await auditCrawl(ctx);
    // Only CRAWL_PAGE_ERROR, no title/description/canonical/jsonld checks
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_ERROR');
  });

  it('handles fetch errors gracefully', async () => {
    mockFetchPage.mockRejectedValue(new Error('Network error'));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/timeout'] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_ERROR');
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('Failed to fetch');
  });

  it('does not run further checks after fetch error', async () => {
    mockFetchPage.mockRejectedValue(new Error('timeout'));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/timeout'] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_ERROR');
  });

  // --- Crawl limit ---

  it('respects crawl limit', async () => {
    mockFetchPage.mockResolvedValue(makePage(GOOD_HTML));
    const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/page-${i}`);
    const ctx = makeCtx({ sitemapUrls: urls, crawlLimit: 3 });
    await auditCrawl(ctx);
    expect(mockFetchPage).toHaveBeenCalledTimes(3);
  });

  it('uses DEFAULT_CRAWL_LIMIT when crawlLimit is not set', async () => {
    mockFetchPage.mockResolvedValue(makePage(GOOD_HTML));
    const urls = Array.from({ length: 60 }, (_, i) => `https://example.com/page-${i}`);
    const ctx = makeCtx({ sitemapUrls: urls });
    await auditCrawl(ctx);
    expect(mockFetchPage).toHaveBeenCalledTimes(50);
  });

  it('crawls all URLs when count is below limit', async () => {
    mockFetchPage.mockResolvedValue(makePage(GOOD_HTML));
    const urls = ['https://example.com/a', 'https://example.com/b'];
    const ctx = makeCtx({ sitemapUrls: urls, crawlLimit: 10 });
    await auditCrawl(ctx);
    expect(mockFetchPage).toHaveBeenCalledTimes(2);
  });

  // --- Multiple pages ---

  it('aggregates findings from multiple pages', async () => {
    mockFetchPage
      .mockResolvedValueOnce(makePage(BAD_HTML))
      .mockResolvedValueOnce(makePage(makeGoodHtml('https://example.com/page-2')))
      .mockResolvedValueOnce(makePage(BAD_HTML));

    const ctx = makeCtx({
      sitemapUrls: [
        'https://example.com/page-1',
        'https://example.com/page-2',
        'https://example.com/page-3',
      ],
    });
    const findings = await auditCrawl(ctx);

    // page-1 and page-3 have issues, page-2 is clean
    const page1 = findings.filter((f) => f.url === 'https://example.com/page-1');
    const page2 = findings.filter((f) => f.url === 'https://example.com/page-2');
    const page3 = findings.filter((f) => f.url === 'https://example.com/page-3');
    expect(page1.length).toBeGreaterThan(0);
    expect(page2).toHaveLength(0);
    expect(page3.length).toBeGreaterThan(0);
  });

  it('continues crawling when one page fails', async () => {
    mockFetchPage
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(makePage(makeGoodHtml('https://example.com/good')))
      .mockResolvedValueOnce(makePage(BAD_HTML));

    const ctx = makeCtx({
      sitemapUrls: [
        'https://example.com/fail',
        'https://example.com/good',
        'https://example.com/bad',
      ],
    });
    const findings = await auditCrawl(ctx);

    expect(mockFetchPage).toHaveBeenCalledTimes(3);
    const failFindings = findings.filter((f) => f.url === 'https://example.com/fail');
    expect(failFindings).toHaveLength(1);
    expect(failFindings[0].code).toBe('CRAWL_PAGE_ERROR');
    const goodFindings = findings.filter((f) => f.url === 'https://example.com/good');
    expect(goodFindings).toHaveLength(0);
    const badFindings = findings.filter((f) => f.url === 'https://example.com/bad');
    expect(badFindings.length).toBeGreaterThan(0);
  });

  // --- Finding properties ---

  it('sets url on all findings', async () => {
    mockFetchPage.mockResolvedValue(makePage(BAD_HTML));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/page-1'] });
    const findings = await auditCrawl(ctx);
    for (const finding of findings) {
      expect(finding.url).toBe('https://example.com/page-1');
    }
  });

  it('sets category to crawl on all findings', async () => {
    mockFetchPage.mockResolvedValue(makePage(BAD_HTML));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/page-1'] });
    const findings = await auditCrawl(ctx);
    for (const finding of findings) {
      expect(finding.category).toBe('crawl');
    }
  });

  it('includes required finding fields on every finding', async () => {
    mockFetchPage.mockResolvedValue(makePage(BAD_HTML));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/page-1'] });
    const findings = await auditCrawl(ctx);
    for (const finding of findings) {
      expect(finding.code).toBeDefined();
      expect(finding.severity).toBeDefined();
      expect(finding.category).toBeDefined();
      expect(finding.message).toBeDefined();
      expect(finding.explanation).toBeDefined();
      expect(finding.suggestion).toBeDefined();
    }
  });

  // --- Progress output ---

  it('writes progress to stderr for each page', async () => {
    mockFetchPage.mockImplementation(async (url: string) => makePage(makeGoodHtml(url)));
    const urls = ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'];
    const ctx = makeCtx({ sitemapUrls: urls });

    // Reset spy right before this test to get accurate count
    stderrSpy.mockClear();
    await auditCrawl(ctx);

    expect(stderrSpy).toHaveBeenCalledTimes(3);
    expect(stderrSpy).toHaveBeenCalledWith('Crawling [1/3] https://example.com/a\n');
    expect(stderrSpy).toHaveBeenCalledWith('Crawling [2/3] https://example.com/b\n');
    expect(stderrSpy).toHaveBeenCalledWith('Crawling [3/3] https://example.com/c\n');
  });

  // --- Concurrency batching ---

  it('processes pages in batches of CRAWL_CONCURRENCY', async () => {
    const callOrder: string[] = [];
    mockFetchPage.mockImplementation(async (url: string) => {
      callOrder.push(url);
      return makePage(GOOD_HTML);
    });

    // 7 URLs with concurrency 5 = batch of 5, then batch of 2
    const urls = Array.from({ length: 7 }, (_, i) => `https://example.com/page-${i}`);
    const ctx = makeCtx({ sitemapUrls: urls });
    await auditCrawl(ctx);

    expect(mockFetchPage).toHaveBeenCalledTimes(7);
    // All 7 URLs should have been called
    for (const url of urls) {
      expect(callOrder).toContain(url);
    }
  });
});
