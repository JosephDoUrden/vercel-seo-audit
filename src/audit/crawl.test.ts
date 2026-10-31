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
  <meta property="og:title" content="Test Page">
  <meta property="og:image" content="https://example.com/og.png">
  <link rel="canonical" href="https://example.com/page-1">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
</head><body></body></html>`;

const BAD_HTML = '<html><head></head><body></body></html>';

describe('auditCrawl fetch options', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchPage.mockResolvedValue(makePage(GOOD_HTML, { finalUrl: 'https://example.com/page-1' }));
  });

  it('fetches crawled pages without the audit cache', async () => {
    const ctx = makeCtx({
      sitemapUrls: ['https://example.com/page-1'],
      fetchOptions: { timeout: 1234, userAgent: 'bot', cache: new Map() },
    });

    await auditCrawl(ctx);

    expect(mockFetchPage).toHaveBeenCalledWith('https://example.com/page-1', {
      timeout: 1234,
      userAgent: 'bot',
      auditedUrl: 'https://example.com/',
    });
    expect(ctx.fetchOptions.cache?.size).toBe(0);
  });

  it('skips sitemap URLs on a private address when the audited site is public', async () => {
    const ctx = makeCtx({ sitemapUrls: ['http://169.254.169.254/latest/', 'https://example.com/page-1'] });

    const findings = await auditCrawl(ctx);

    expect(mockFetchPage.mock.calls.map(([u]) => u)).toEqual(['https://example.com/page-1']);
    expect(findings).toEqual([]);
  });

  it('reports RESPONSE_TOO_LARGE for a page cut at the body cap, and still audits what was read', async () => {
    mockFetchPage.mockResolvedValue({
      ...makePage(GOOD_HTML, { finalUrl: 'https://example.com/page-1' }),
      truncated: true,
    });

    const findings = await auditCrawl(makeCtx({ sitemapUrls: ['https://example.com/page-1'] }));

    expect(findings.map((f) => f.code)).toEqual(['RESPONSE_TOO_LARGE']);
    expect(findings[0]).toMatchObject({ category: 'crawl', url: 'https://example.com/page-1' });
  });
});

function makeGoodHtml(pageUrl: string): string {
  return `<html><head>
  <title>Test Page</title>
  <meta name="description" content="A test page">
  <meta property="og:title" content="Test Page">
  <meta property="og:image" content="https://example.com/og.png">
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
    const html = '<html><head><meta property="og:title" content="T"><meta property="og:image" content="https://example.com/og.png"><meta name="robots" content="noindex"><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/p"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/p'] });
    const findings = await auditCrawl(ctx);
    const noindex = findings.filter((f) => f.code === 'CRAWL_PAGE_NOINDEX');
    expect(noindex).toHaveLength(1);
    expect(noindex[0].severity).toBe('warning');
  });

  it('detects noindex via an upper-case meta name="ROBOTS"', async () => {
    const html = '<html><head><meta property="og:title" content="T"><meta property="og:image" content="https://example.com/og.png"><meta name="ROBOTS" content="noindex"><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/p"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/p'] });
    const findings = await auditCrawl(ctx);
    expect(findings.some((f) => f.code === 'CRAWL_PAGE_NOINDEX')).toBe(true);
  });

  it('detects noindex via meta name="googlebot"', async () => {
    const html = '<html><head><meta property="og:title" content="T"><meta property="og:image" content="https://example.com/og.png"><meta name="googlebot" content="noindex"><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/p"><script type="application/ld+json">{}</script></head><body></body></html>';
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
    const html = '<html><head><meta property="og:title" content="T"><meta property="og:image" content="https://example.com/og.png"><meta name="robots" content="noindex"><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/p"><script type="application/ld+json">{}</script></head><body></body></html>';
    const headers = new Headers({ 'x-robots-tag': 'noindex' });
    mockFetchPage.mockResolvedValue(makePage(html, { headers }));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/p'] });
    const findings = await auditCrawl(ctx);
    const noindex = findings.filter((f) => f.code === 'CRAWL_PAGE_NOINDEX');
    expect(noindex).toHaveLength(2);
  });

  it('detects missing title only (other elements present)', async () => {
    const html = '<html><head><meta property="og:title" content="T"><meta property="og:image" content="https://example.com/og.png"><meta name="description" content="D"><link rel="canonical" href="https://example.com/p"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/p'] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_TITLE_MISSING');
    expect(findings[0].severity).toBe('warning');
  });

  it('detects missing description with correct severity', async () => {
    const html = '<html><head><meta property="og:title" content="T"><meta property="og:image" content="https://example.com/og.png"><title>T</title><link rel="canonical" href="https://example.com/p"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/p'] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_DESCRIPTION_MISSING');
    expect(findings[0].severity).toBe('info');
  });

  it('detects missing JSON-LD only with correct severity', async () => {
    const html = '<html><head><meta property="og:title" content="T"><meta property="og:image" content="https://example.com/og.png"><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/p"></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/p'] });
    const findings = await auditCrawl(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('CRAWL_PAGE_JSONLD_MISSING');
    expect(findings[0].severity).toBe('info');
  });

  // --- Canonical checks ---

  it('detects canonical mismatch', async () => {
    const html = '<html><head><meta property="og:title" content="T"><meta property="og:image" content="https://example.com/og.png"><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/other-page"><script type="application/ld+json">{}</script></head><body></body></html>';
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
    const html = '<html><head><meta property="og:title" content="T"><meta property="og:image" content="https://example.com/og.png"><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://example.com/page-1/"><script type="application/ld+json">{}</script></head><body></body></html>';
    mockFetchPage.mockResolvedValue(makePage(html));
    const ctx = makeCtx({ sitemapUrls: ['https://example.com/page-1'] });
    const findings = await auditCrawl(ctx);
    expect(findings.some((f) => f.code === 'CRAWL_PAGE_CANONICAL_MISMATCH')).toBe(false);
    expect(findings.some((f) => f.code === 'CRAWL_PAGE_CANONICAL_MISSING')).toBe(false);
  });

  it('resolves relative canonical URL against page URL', async () => {
    const html = '<html><head><meta property="og:title" content="T"><meta property="og:image" content="https://example.com/og.png"><title>T</title><meta name="description" content="D"><link rel="canonical" href="/page-1"><script type="application/ld+json">{}</script></head><body></body></html>';
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

// A page that passes every per-page check; parts can be swapped out per test.
function page(
  url: string,
  opts: { title?: string; description?: string; canonical?: string; head?: string; body?: string } = {},
): string {
  const { title = `Title of ${url}`, description = `About ${url}`, canonical = url, head = '', body = '' } = opts;
  return `<html><head>
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${title}">
  <meta property="og:image" content="https://example.com/og.png">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
  ${head}
</head><body>${body}</body></html>`;
}

const A = 'https://example.com/a';
const B = 'https://example.com/b';
const C = 'https://example.com/c';

async function crawl(pages: Record<string, string>) {
  mockFetchPage.mockImplementation(async (url: string) => makePage(pages[url], { finalUrl: url }));
  return auditCrawl(makeCtx({ sitemapUrls: Object.keys(pages) }));
}

describe('auditCrawl page checks and duplicate detection', () => {
  it('reports nothing for a crawl of distinct, complete pages, with one GET per page', async () => {
    const findings = await crawl({ [A]: page(A), [B]: page(B), [C]: page(C) });
    expect(findings).toEqual([]);
    expect(mockFetchPage).toHaveBeenCalledTimes(3);
  });

  it('reports CRAWL_PAGE_HREFLANG_MISSING_SELF only on the page whose hreflang skips itself', async () => {
    const alt = (href: string, lang: string) => `<link rel="alternate" hreflang="${lang}" href="${href}">`;
    const findings = await crawl({
      [A]: page(A, { head: alt(A, 'en') + alt(B, 'de') }),
      [B]: page(B, { head: alt(A, 'en') + alt(C, 'fr') }),
      [C]: page(C),
    });
    expect(findings.map((f) => [f.code, f.url])).toEqual([['CRAWL_PAGE_HREFLANG_MISSING_SELF', B]]);
    expect(findings[0]).toMatchObject({ severity: 'warning', details: { hreflang: ['en', 'fr'] } });
  });

  it('reports CRAWL_PAGE_IMAGES_MISSING_ALT with the count, ignoring alt=""', async () => {
    const findings = await crawl({
      [A]: page(A, { body: '<img src="/1.png"><img src="/2.png"><img src="/3.png" alt="">' }),
      [B]: page(B, { body: '<img src="/4.png" alt="Logo">' }),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'CRAWL_PAGE_IMAGES_MISSING_ALT',
      severity: 'warning',
      url: A,
      details: { count: 2, srcs: ['/1.png', '/2.png'] },
    });
  });

  it('reports one CRAWL_PAGE_OG_MISSING per page naming what is missing', async () => {
    const findings = await crawl({
      [A]: page(A).replace(/<meta property="og:[^>]+>/g, ''),
      [B]: page(B).replace(/<meta property="og:image"[^>]+>/, ''),
      [C]: page(C),
    });
    expect(findings.map((f) => [f.code, f.url, f.details])).toEqual([
      ['CRAWL_PAGE_OG_MISSING', A, { missing: ['og:title', 'og:image'] }],
      ['CRAWL_PAGE_OG_MISSING', B, { missing: ['og:image'] }],
    ]);
  });

  it('reports CRAWL_PAGE_METADATA_IN_BODY for tags in <body> alone, without a second request', async () => {
    const streamed = `<html><head>
  <meta property="og:title" content="T"><meta property="og:image" content="https://example.com/og.png">
  <script type="application/ld+json">{}</script>
</head><body><div>x</div><title>Streamed</title><meta name="description" content="D"><link rel="canonical" href="${B}"></body></html>`;
    const findings = await crawl({ [A]: page(A), [B]: streamed });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'CRAWL_PAGE_METADATA_IN_BODY',
      severity: 'warning',
      url: B,
      details: { bodyOnly: ['title', 'description', 'canonical'] },
    });
    expect(findings[0].explanation).toContain('no second request');
    expect(mockFetchPage).toHaveBeenCalledTimes(2);
  });

  it('reports CRAWL_PAGE_CANONICAL_MULTIPLE only when the <head> canonicals differ', async () => {
    const findings = await crawl({
      [A]: page(A, { head: `<link rel="canonical" href="${B}">` }),
      [B]: page(B, { head: `<link rel="canonical" href="${B}">` }),
    });
    const multiple = findings.filter((f) => f.code === 'CRAWL_PAGE_CANONICAL_MULTIPLE');
    expect(multiple).toHaveLength(1);
    expect(multiple[0]).toMatchObject({ severity: 'warning', url: A, details: { hrefs: [A, B] } });
  });

  it('reports CRAWL_PAGE_CANONICAL_RELATIVE for a relative and a fragment canonical', async () => {
    const findings = await crawl({
      [A]: page(A, { canonical: '/a' }),
      [B]: page(B, { canonical: `${B}#top` }),
      [C]: page(C),
    });
    const relative = findings.filter((f) => f.code === 'CRAWL_PAGE_CANONICAL_RELATIVE');
    expect(relative.map((f) => [f.url, f.details])).toEqual([
      [A, { href: '/a', kind: 'relative' }],
      [B, { href: `${B}#top`, kind: 'fragment' }],
    ]);
    expect(relative.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('reports CRAWL_DUPLICATE_TITLES once per shared title, with sorted URLs', async () => {
    const findings = await crawl({
      [C]: page(C, { title: 'Shared' }),
      [A]: page(A, { title: 'Shared' }),
      [B]: page(B),
    });
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'CRAWL_DUPLICATE_TITLES',
        severity: 'warning',
        url: A,
        details: { title: 'Shared', count: 2, urls: [A, C] },
      }),
    ]);
  });

  it('reports CRAWL_DUPLICATE_DESCRIPTIONS for pages sharing a meta description', async () => {
    const findings = await crawl({
      [A]: page(A, { description: 'Same' }),
      [B]: page(B, { description: 'Same' }),
      [C]: page(C, { description: 'Same' }),
    });
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'CRAWL_DUPLICATE_DESCRIPTIONS',
        severity: 'warning',
        details: { description: 'Same', count: 3, urls: [A, B, C] },
      }),
    ]);
  });

  it('caps duplicate groups at 10, sorted by value, and the URLs in each at 10', async () => {
    const pages: Record<string, string> = {};
    for (let g = 11; g >= 0; g--) {
      for (let p = 0; p < 2; p++) {
        const url = `https://example.com/g${g}-${p}`;
        pages[url] = page(url, { title: `Group ${String(g).padStart(2, '0')}` });
      }
    }
    for (let p = 0; p < 12; p++) {
      const url = `https://example.com/big-${String(p).padStart(2, '0')}`;
      pages[url] = page(url, { description: 'Same everywhere' });
    }
    mockFetchPage.mockImplementation(async (url: string) => makePage(pages[url], { finalUrl: url }));
    const findings = await auditCrawl(makeCtx({ sitemapUrls: Object.keys(pages), crawlLimit: 100 }));

    const titles = findings.filter((f) => f.code === 'CRAWL_DUPLICATE_TITLES');
    expect(titles.map((f) => f.details?.title)).toEqual(
      Array.from({ length: 10 }, (_, g) => `Group ${String(g).padStart(2, '0')}`),
    );
    const descriptions = findings.filter((f) => f.code === 'CRAWL_DUPLICATE_DESCRIPTIONS');
    expect(descriptions).toHaveLength(1);
    expect(descriptions[0].details).toMatchObject({ description: 'Same everywhere', count: 12 });
    expect(descriptions[0].details?.urls).toHaveLength(10);
  });

  it('leaves pages that answered non-2xx out of the duplicate checks', async () => {
    mockFetchPage.mockImplementation(async (url: string) =>
      makePage(page(url, { title: 'Shared' }), { status: url === B ? 404 : 200 }),
    );
    const findings = await auditCrawl(makeCtx({ sitemapUrls: [A, B] }));
    expect(findings.map((f) => f.code)).toEqual(['CRAWL_PAGE_ERROR']);
  });

  it('reports CRAWL_CANONICAL_CHAIN when a canonical target names another canonical', async () => {
    const findings = await crawl({
      [A]: page(A, { canonical: `${B}/` }),
      [B]: page(B, { canonical: C }),
      [C]: page(C),
    });
    const chains = findings.filter((f) => f.code === 'CRAWL_CANONICAL_CHAIN');
    expect(chains).toHaveLength(1);
    expect(chains[0]).toMatchObject({ severity: 'warning', url: A, details: { canonical: `${B}/`, next: C } });
    // Each hop is still its own per-page mismatch.
    expect(findings.filter((f) => f.code === 'CRAWL_PAGE_CANONICAL_MISMATCH').map((f) => f.url)).toEqual([A, B]);
  });

  it('reports no chain when the canonical target is canonical to itself or was not crawled', async () => {
    const findings = await crawl({
      [A]: page(A, { canonical: B }),
      [B]: page(B),
      [C]: page(C, { canonical: 'https://example.com/elsewhere' }),
    });
    expect(findings.some((f) => f.code === 'CRAWL_CANONICAL_CHAIN')).toBe(false);
  });

  it('puts the crawl-wide findings after the per-page ones, in a fixed order', async () => {
    const pages = {
      [A]: page(A, { title: 'T', description: 'D', canonical: B }),
      [B]: page(B, { title: 'T', description: 'D', canonical: C }),
      [C]: page(C),
    };
    const first = (await crawl(pages)).map((f) => `${f.code} ${f.url}`);
    const second = (await crawl(pages)).map((f) => `${f.code} ${f.url}`);
    expect(first).toEqual(second);
    expect(first).toEqual([
      `CRAWL_PAGE_CANONICAL_MISMATCH ${A}`,
      `CRAWL_PAGE_CANONICAL_MISMATCH ${B}`,
      `CRAWL_DUPLICATE_TITLES ${A}`,
      `CRAWL_DUPLICATE_DESCRIPTIONS ${A}`,
      `CRAWL_CANONICAL_CHAIN ${A}`,
    ]);
  });
});
