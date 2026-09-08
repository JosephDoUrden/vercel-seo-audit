import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAudit } from './runner.js';

vi.mock('./utils/http.js', () => ({
  fetchPage: vi.fn(),
}));

vi.mock('./audit/index.js', () => ({
  auditRedirects: vi.fn(),
  auditRobots: vi.fn(),
  auditSitemap: vi.fn(),
  auditMetadata: vi.fn(),
  auditFavicon: vi.fn(),
  auditNextjs: vi.fn(),
  auditStructuredData: vi.fn(),
  auditCrawl: vi.fn(),
  auditI18n: vi.fn(),
  auditImages: vi.fn(),
  auditSecurity: vi.fn(),
  auditPerformance: vi.fn(),
}));

import { fetchPage } from './utils/http.js';
import {
  auditRedirects,
  auditRobots,
  auditSitemap,
  auditMetadata,
  auditFavicon,
  auditNextjs,
  auditStructuredData,
  auditCrawl,
  auditI18n,
  auditImages,
  auditSecurity,
  auditPerformance,
} from './audit/index.js';

const mockFetchPage = vi.mocked(fetchPage);
const mockRedirects = vi.mocked(auditRedirects);
const mockRobots = vi.mocked(auditRobots);
const mockSitemap = vi.mocked(auditSitemap);
const mockMetadata = vi.mocked(auditMetadata);
const mockFavicon = vi.mocked(auditFavicon);
const mockNextjs = vi.mocked(auditNextjs);
const mockStructuredData = vi.mocked(auditStructuredData);
const mockCrawl = vi.mocked(auditCrawl);
const mockI18n = vi.mocked(auditI18n);
const mockImages = vi.mocked(auditImages);
const mockSecurity = vi.mocked(auditSecurity);
const mockPerformance = vi.mocked(auditPerformance);

beforeEach(() => {
  vi.resetAllMocks();

  mockFetchPage.mockResolvedValue({
    body: '<html><head><title>Example</title></head></html>',
    status: 200,
    headers: new Headers({ 'x-powered-by': 'Next.js' }),
    finalUrl: 'https://example.com/',
  });

  // Default: all modules return empty findings
  mockRedirects.mockResolvedValue([]);
  mockRobots.mockResolvedValue([]);
  mockSitemap.mockResolvedValue([]);
  mockMetadata.mockResolvedValue([]);
  mockFavicon.mockResolvedValue([]);
  mockNextjs.mockResolvedValue([]);
  mockStructuredData.mockResolvedValue([]);
  mockCrawl.mockResolvedValue([]);
  mockI18n.mockResolvedValue([]);
  mockImages.mockResolvedValue([]);
  mockSecurity.mockResolvedValue([]);
  mockPerformance.mockResolvedValue([]);
});

describe('runAudit', () => {
  it('returns a valid AuditReport structure', async () => {
    const report = await runAudit('example.com');

    expect(report.url).toBe('https://example.com/');
    expect(report.timestamp).toBeDefined();
    expect(report.duration).toBeGreaterThanOrEqual(0);
    expect(report.summary).toEqual({ errors: 0, warnings: 0, info: 0, passed: 0 });
    expect(report.modules).toBeInstanceOf(Array);
  });

  it('runs phase 1 modules (robots, redirects)', async () => {
    await runAudit('https://example.com');

    expect(mockRobots).toHaveBeenCalledTimes(1);
    expect(mockRedirects).toHaveBeenCalledTimes(1);
  });

  it('runs phase 2 modules (sitemap, metadata, favicon, nextjs, structuredData, i18n, images, security, performance)', async () => {
    await runAudit('https://example.com');

    expect(mockSitemap).toHaveBeenCalledTimes(1);
    expect(mockMetadata).toHaveBeenCalledTimes(1);
    expect(mockFavicon).toHaveBeenCalledTimes(1);
    expect(mockNextjs).toHaveBeenCalledTimes(1);
    expect(mockStructuredData).toHaveBeenCalledTimes(1);
    expect(mockI18n).toHaveBeenCalledTimes(1);
    expect(mockImages).toHaveBeenCalledTimes(1);
    expect(mockSecurity).toHaveBeenCalledTimes(1);
    expect(mockPerformance).toHaveBeenCalledTimes(1);
  });

  it('does not run crawl module when crawl option is not set', async () => {
    await runAudit('https://example.com');
    expect(mockCrawl).not.toHaveBeenCalled();
  });

  it('runs crawl module when crawl option is set', async () => {
    await runAudit('https://example.com', { crawl: 10 });
    expect(mockCrawl).toHaveBeenCalledTimes(1);
  });

  it('computes summary counts correctly', async () => {
    mockRobots.mockResolvedValue([
      {
        code: 'ROBOTS_BLOCKS_ALL',
        severity: 'error',
        category: 'robots',
        message: 'msg',
        explanation: 'exp',
        suggestion: 'sug',
      },
    ]);
    mockMetadata.mockResolvedValue([
      {
        code: 'CANONICAL_MISSING',
        severity: 'warning',
        category: 'metadata',
        message: 'msg',
        explanation: 'exp',
        suggestion: 'sug',
      },
      {
        code: 'DESCRIPTION_MISSING',
        severity: 'info',
        category: 'metadata',
        message: 'msg',
        explanation: 'exp',
        suggestion: 'sug',
      },
    ]);
    mockSitemap.mockResolvedValue([
      {
        code: 'SITEMAP_MISSING',
        severity: 'pass',
        category: 'sitemap',
        message: 'msg',
        explanation: 'exp',
        suggestion: 'sug',
      },
    ]);

    const report = await runAudit('https://example.com');
    expect(report.summary).toEqual({
      errors: 1,
      warnings: 1,
      info: 1,
      passed: 1,
    });
  });

  it('handles module failures gracefully via Promise.allSettled', async () => {
    mockRedirects.mockRejectedValue(new Error('Unexpected error'));
    mockRobots.mockResolvedValue([
      {
        code: 'ROBOTS_NO_SITEMAP',
        severity: 'info',
        category: 'robots',
        message: 'msg',
        explanation: 'exp',
        suggestion: 'sug',
      },
    ]);

    const report = await runAudit('https://example.com');
    // redirects module should be excluded but robots should still be present
    const moduleNames = report.modules.map((m) => m.module);
    expect(moduleNames).toContain('robots');
    expect(moduleNames).not.toContain('redirects');
  });

  it('normalizes the input URL', async () => {
    const report = await runAudit('example.com');
    expect(report.url).toBe('https://example.com/');
  });

  it('passes options to context', async () => {
    await runAudit('https://example.com', {
      verbose: true,
      timeout: 5000,
      pages: ['/custom'],
      userAgent: 'custom-agent',
      crawl: 20,
    });

    const ctx = mockRobots.mock.calls[0][0];
    expect(ctx.verbose).toBe(true);
    expect(ctx.fetchOptions.timeout).toBe(5000);
    expect(ctx.fetchOptions.userAgent).toBe('custom-agent');
    expect(ctx.pages).toEqual(['/custom']);
    expect(ctx.crawlLimit).toBe(20);
  });

  it('includes all module results in report', async () => {
    const report = await runAudit('https://example.com');
    const names = report.modules.map((m) => m.module);
    expect(names).toContain('robots');
    expect(names).toContain('redirects');
    expect(names).toContain('sitemap');
    expect(names).toContain('metadata');
    expect(names).toContain('favicon');
    expect(names).toContain('nextjs');
    expect(names).toContain('structuredData');
    expect(names).toContain('i18n');
    expect(names).toContain('images');
    expect(names).toContain('security');
    expect(names).toContain('performance');
  });

  it('fetches the page once up front and shares it with every module', async () => {
    await runAudit('https://example.com');

    expect(mockFetchPage).toHaveBeenCalledTimes(1);
    expect(mockFetchPage).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({ cache: expect.any(Map) }),
    );

    for (const mod of [mockRobots, mockRedirects, mockMetadata, mockNextjs, mockSecurity]) {
      const ctx = mod.mock.calls[0][0];
      expect(ctx.html).toBe('<html><head><title>Example</title></head></html>');
      expect(ctx.headers).toEqual({ 'x-powered-by': 'Next.js' });
      expect(ctx.finalUrl).toBe('https://example.com/');
    }
  });

  it('gives every module the same per-audit fetch cache', async () => {
    await runAudit('https://example.com');

    const cache = mockRobots.mock.calls[0][0].fetchOptions.cache;
    expect(cache).toBeInstanceOf(Map);
    expect(mockMetadata.mock.calls[0][0].fetchOptions.cache).toBe(cache);
  });

  it('does not share a non-2xx page and empties the cache so modules refetch', async () => {
    mockFetchPage.mockImplementation(async (_url, fetchOptions) => {
      fetchOptions?.cache?.set('MANUAL https://example.com/', Promise.resolve(undefined));
      return { body: 'boom', status: 500, headers: new Headers(), finalUrl: 'https://example.com/' };
    });

    await runAudit('https://example.com');

    const ctx = mockMetadata.mock.calls[0][0];
    expect(ctx.html).toBeUndefined();
    expect(ctx.headers).toBeUndefined();
    expect(ctx.finalUrl).toBeUndefined();
    expect(ctx.fetchOptions.cache?.size).toBe(0);
  });

  it('leaves the shared page unset when the up-front fetch fails', async () => {
    mockFetchPage.mockRejectedValue(new Error('timeout'));

    const report = await runAudit('https://example.com');

    expect(report.modules.map((m) => m.module)).toContain('metadata');
    const ctx = mockMetadata.mock.calls[0][0];
    expect(ctx.html).toBeUndefined();
    expect(ctx.headers).toBeUndefined();
    expect(ctx.finalUrl).toBeUndefined();
  });
});
