import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAudit, phases } from './runner.js';
import { MODULE_IDS } from './types.js';

vi.mock('./utils/http.js', async (importOriginal) => ({
  RedirectError: (await importOriginal<typeof import('./utils/http.js')>()).RedirectError,
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
  auditVercel: vi.fn(),
  auditStreamedMetadata: vi.fn(),
  auditHostLeak: vi.fn(),
  auditUaParity: vi.fn(),
}));

import { fetchPage, RedirectError } from './utils/http.js';
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
  auditVercel,
  auditStreamedMetadata,
  auditHostLeak,
  auditUaParity,
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
const mockVercel = vi.mocked(auditVercel);
const mockStreamedMetadata = vi.mocked(auditStreamedMetadata);
const mockHostLeak = vi.mocked(auditHostLeak);
const mockUaParity = vi.mocked(auditUaParity);

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
  mockVercel.mockResolvedValue([]);
  mockStreamedMetadata.mockResolvedValue([]);
  mockHostLeak.mockResolvedValue([]);
  mockUaParity.mockResolvedValue([]);
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

  it('runs phase 2 modules (sitemap, metadata, favicon, nextjs, structuredData, i18n, images, security, performance, vercel, streamedMetadata, hostLeak, uaParity)', async () => {
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
    expect(mockVercel).toHaveBeenCalledTimes(1);
    expect(mockStreamedMetadata).toHaveBeenCalledTimes(1);
    expect(mockHostLeak).toHaveBeenCalledTimes(1);
    expect(mockUaParity).toHaveBeenCalledTimes(1);
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
    expect(report.summary).not.toHaveProperty('ignored');
    expect(report.summary).toEqual({
      errors: 1,
      warnings: 1,
      info: 1,
      passed: 1,
    });
  });

  it('marks ignored findings and leaves them out of the severity counts', async () => {
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

    const report = await runAudit('https://example.com', {
      ignore: ['ROBOTS_BLOCKS_ALL', 'CANONICAL_MISSING'],
    });

    expect(report.summary).toEqual({ errors: 0, warnings: 0, info: 1, passed: 0, ignored: 2 });

    const findings = report.modules.flatMap((m) => m.findings);
    expect(findings).toHaveLength(3);
    expect(findings.find((f) => f.code === 'ROBOTS_BLOCKS_ALL')?.ignored).toBe(true);
    expect(findings.find((f) => f.code === 'CANONICAL_MISSING')?.ignored).toBe(true);
    expect(findings.find((f) => f.code === 'DESCRIPTION_MISSING')).not.toHaveProperty('ignored');
  });

  it('ignores every finding with a matching code, across modules and urls', async () => {
    const finding = {
      code: 'CRAWL_PAGE_TITLE_MISSING' as const,
      severity: 'warning' as const,
      category: 'crawl' as const,
      message: 'msg',
      explanation: 'exp',
      suggestion: 'sug',
    };
    mockCrawl.mockResolvedValue([
      { ...finding, url: 'https://example.com/a' },
      { ...finding, url: 'https://example.com/b' },
    ]);

    const report = await runAudit('https://example.com', {
      crawl: 10,
      ignore: ['CRAWL_PAGE_TITLE_MISSING'],
    });

    expect(report.summary.warnings).toBe(0);
    expect(report.summary.ignored).toBe(2);
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
    const redirects = report.modules.find((m) => m.module === 'redirects');

    // The other modules still run; the failed one reports the failure.
    expect(report.modules.find((m) => m.module === 'robots')?.findings).toHaveLength(1);
    expect(redirects?.findings).toEqual([
      expect.objectContaining({
        code: 'MODULE_FAILED',
        severity: 'error',
        category: 'redirect',
        details: { module: 'redirects', message: 'Unexpected error' },
      }),
    ]);
    expect(redirects?.findings[0].message).toContain('redirects');
    expect(report.summary.errors).toBe(1);
  });

  it('keeps the module order when one fails, and names a non-Error rejection', async () => {
    mockCrawl.mockRejectedValue('boom');
    mockStructuredData.mockRejectedValue(new TypeError('x is undefined'));

    const report = await runAudit('https://example.com', { crawl: 3 });
    const failed = report.modules.flatMap((m) => m.findings).filter((f) => f.code === 'MODULE_FAILED');

    expect(report.modules.map((m) => m.module)).toEqual([...MODULE_IDS]);
    expect(failed.map((f) => [f.category, f.details])).toEqual([
      ['structured-data', { module: 'structuredData', message: 'x is undefined' }],
      ['crawl', { module: 'crawl', message: 'boom' }],
    ]);
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
    expect(names).toContain('vercel');
    expect(names).toContain('streamedMetadata');
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

});

describe('runAudit when the target cannot be audited', () => {
  const everyModule = () => [
    mockRobots,
    mockRedirects,
    mockSitemap,
    mockMetadata,
    mockFavicon,
    mockNextjs,
    mockStructuredData,
    mockI18n,
    mockImages,
    mockSecurity,
    mockPerformance,
    mockVercel,
    mockStreamedMetadata,
    mockCrawl,
  ];
  const htmlModules = () => [
    mockMetadata,
    mockFavicon,
    mockStructuredData,
    mockI18n,
    mockImages,
    mockPerformance,
    mockStreamedMetadata,
  ];
  const headerModules = () => [mockRobots, mockRedirects, mockSitemap, mockNextjs, mockSecurity, mockVercel];

  it('reports one TARGET_UNREACHABLE error and runs no module when the fetch fails', async () => {
    mockFetchPage.mockRejectedValue(
      new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND no-such-host.invalid') }),
    );

    const report = await runAudit('https://no-such-host.invalid', { crawl: 5 });

    for (const mock of everyModule()) expect(mock).not.toHaveBeenCalled();
    expect(report.modules).toHaveLength(1);
    expect(report.modules[0].module).toBe('target');
    expect(report.modules[0].findings).toHaveLength(1);
    expect(report.modules[0].findings[0]).toMatchObject({
      code: 'TARGET_UNREACHABLE',
      severity: 'error',
      category: 'indexing',
      url: 'https://no-such-host.invalid/',
      details: { error: 'fetch failed: getaddrinfo ENOTFOUND no-such-host.invalid' },
    });
    expect(report.modules[0].findings[0].message).toContain('ENOTFOUND');
    expect(report.summary).toEqual({ errors: 1, warnings: 0, info: 0, passed: 0 });
    expect(report.page).toEqual({ status: null, finalUrl: null, nextjs: false });
  });

  it.each([
    ['loop', 'Redirect loop at https://example.com/loop/0'],
    ['limit', 'More than 20 redirects from https://example.com/loop/0'],
  ] as const)('runs the modules on a redirect %s instead of calling the target unreachable', async (kind, message) => {
    mockFetchPage.mockRejectedValue(new RedirectError(kind, message));

    const report = await runAudit('https://example.com/loop/0');

    expect(report.modules.map((m) => m.module)).not.toContain('target');
    expect(mockRedirects).toHaveBeenCalledTimes(1);
    expect(mockMetadata).toHaveBeenCalledTimes(1);
    expect(mockRedirects.mock.calls[0][0].html).toBeUndefined();
    expect(report.page).toEqual({ status: null, finalUrl: null, nextjs: false });
  });

  it('tells every fetch which URL is being audited, for the private-address check', async () => {
    await runAudit('https://example.com/a');

    expect(mockFetchPage.mock.calls[0][1]).toMatchObject({ auditedUrl: 'https://example.com/a' });
    expect(mockRobots.mock.calls[0][0].fetchOptions.auditedUrl).toBe('https://example.com/a');
  });

  it('uses the plain message when the error has no cause', async () => {
    mockFetchPage.mockRejectedValue(new Error('Timed out after 2000 ms fetching https://example.com/'));

    const report = await runAudit('https://example.com');

    expect(report.modules[0].findings[0].details).toEqual({
      error: 'Timed out after 2000 ms fetching https://example.com/',
    });
  });

  it('runs nothing on a run limited with only either', async () => {
    mockFetchPage.mockRejectedValue(new Error('ECONNREFUSED'));

    const report = await runAudit('https://example.com', { only: ['vercel'] });

    expect(mockVercel).not.toHaveBeenCalled();
    expect(report.modules.map((m) => m.module)).toEqual(['target']);
  });

  it('can still be ignored out of the counts', async () => {
    mockFetchPage.mockRejectedValue(new Error('ECONNREFUSED'));

    const report = await runAudit('https://example.com', { ignore: ['TARGET_UNREACHABLE'] });

    expect(report.modules[0].findings[0].ignored).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  it.each([404, 410, 500, 503])('reports TARGET_HTTP_ERROR for a %i page and still runs the modules', async (status) => {
    mockFetchPage.mockResolvedValue({
      body: 'nope',
      status,
      headers: new Headers({ 'content-type': 'text/html' }),
      finalUrl: 'https://example.com/missing',
    });

    const report = await runAudit('https://example.com/missing');
    const target = report.modules.find((m) => m.module === 'target');

    expect(target?.findings).toEqual([
      expect.objectContaining({
        code: 'TARGET_HTTP_ERROR',
        severity: 'error',
        category: 'indexing',
        url: 'https://example.com/missing',
        details: { status, finalUrl: 'https://example.com/missing' },
      }),
    ]);
    expect(target?.findings[0].message).toContain(String(status));
    expect(mockMetadata).toHaveBeenCalledTimes(1);
    expect(report.modules[0].module).toBe('target');
  });

  it('leaves a challenged entry page to EDGE_CHALLENGE instead of adding TARGET_HTTP_ERROR', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<html>challenge</html>',
      status: 403,
      headers: new Headers({ 'x-vercel-mitigated': 'challenge' }),
      finalUrl: 'https://example.com/',
    });

    const report = await runAudit('https://example.com');

    expect(report.modules.map((m) => m.module)).not.toContain('target');
    expect(mockVercel).toHaveBeenCalledTimes(1);
  });

  it('adds no target finding for a 2xx HTML page', async () => {
    const report = await runAudit('https://example.com');
    expect(report.modules.map((m) => m.module)).not.toContain('target');
  });

  it('treats a page without a content-type as HTML', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<html></html>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/',
    });

    const report = await runAudit('https://example.com');

    expect(report.modules.map((m) => m.module)).not.toContain('target');
    expect(mockMetadata).toHaveBeenCalledTimes(1);
  });

  it.each(['text/html; charset=utf-8', 'application/xhtml+xml', 'TEXT/HTML'])('treats %s as HTML', async (type) => {
    mockFetchPage.mockResolvedValue({
      body: '<html></html>',
      status: 200,
      headers: new Headers({ 'content-type': type }),
      finalUrl: 'https://example.com/',
    });

    const report = await runAudit('https://example.com');

    expect(report.modules.map((m) => m.module)).not.toContain('target');
  });

  it('reports TARGET_NOT_HTML for a PDF and runs only the modules that do not read HTML', async () => {
    mockFetchPage.mockResolvedValue({
      body: '%PDF-1.7',
      status: 200,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      finalUrl: 'https://example.com/doc.pdf',
    });

    const report = await runAudit('https://example.com/doc.pdf');
    const target = report.modules.find((m) => m.module === 'target');

    expect(target?.findings).toEqual([
      expect.objectContaining({
        code: 'TARGET_NOT_HTML',
        severity: 'warning',
        category: 'indexing',
        details: { contentType: 'application/pdf', bytes: 8 },
      }),
    ]);
    for (const mock of htmlModules()) expect(mock).not.toHaveBeenCalled();
    for (const mock of headerModules()) expect(mock).toHaveBeenCalledTimes(1);

    // Header modules get the headers but not the body as HTML.
    const ctx = mockSecurity.mock.calls[0][0];
    expect(ctx.headers).toEqual({ 'content-type': 'application/pdf' });
    expect(ctx.html).toBeUndefined();
    expect(ctx.finalUrl).toBe('https://example.com/doc.pdf');
  });

  it('reports TARGET_NOT_HTML for an empty HTML body', async () => {
    mockFetchPage.mockResolvedValue({
      body: '  \n',
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      finalUrl: 'https://example.com/',
    });

    const report = await runAudit('https://example.com');
    const finding = report.modules.find((m) => m.module === 'target')?.findings[0];

    expect(finding).toMatchObject({ code: 'TARGET_NOT_HTML', details: { contentType: 'text/html', bytes: 3 } });
    expect(finding?.message).toMatch(/empty/i);
    for (const mock of htmlModules()) expect(mock).not.toHaveBeenCalled();
  });

  it('reports RESPONSE_TOO_LARGE for a page cut at the body cap and audits what was read', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<html><head><title>Big</title></head>',
      status: 200,
      headers: new Headers({ 'content-type': 'text/html', 'content-length': '314572800' }),
      finalUrl: 'https://example.com/',
      truncated: true,
    });

    const report = await runAudit('https://example.com');
    const target = report.modules.find((m) => m.module === 'target');

    expect(target?.findings).toEqual([
      expect.objectContaining({
        code: 'RESPONSE_TOO_LARGE',
        severity: 'warning',
        category: 'performance',
        url: 'https://example.com/',
        details: { bytes: 314572800, limit: 10 * 1024 * 1024 },
      }),
    ]);
    expect(mockMetadata.mock.calls[0][0].html).toBe('<html><head><title>Big</title></head>');
  });

  it('keeps an only selection to the header modules it named', async () => {
    mockFetchPage.mockResolvedValue({
      body: '%PDF',
      status: 200,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      finalUrl: 'https://example.com/',
    });

    const report = await runAudit('https://example.com', { only: ['metadata', 'security'] });

    expect(mockMetadata).not.toHaveBeenCalled();
    expect(mockSecurity).toHaveBeenCalledTimes(1);
    expect(report.modules.map((m) => m.module)).toEqual(['target', 'security']);
  });
});

describe('runAudit report.page', () => {
  it('records the phase 0 status, final URL and whether the page looks like Next.js', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<html><head></head></html>',
      status: 200,
      headers: new Headers({ 'x-powered-by': 'Next.js' }),
      finalUrl: 'https://www.example.com/',
    });
    const report = await runAudit('https://example.com');
    expect(report.page).toEqual({ status: 200, finalUrl: 'https://www.example.com/', nextjs: true });
  });

  it('reads Next.js build markers in the HTML too', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<html><body><div id="__next"></div></body></html>',
      status: 200,
      headers: new Headers({ server: 'Vercel' }),
      finalUrl: 'https://example.com/',
    });
    const report = await runAudit('https://example.com');
    expect(report.page?.nextjs).toBe(true);
  });

  it('says not Next.js for a page without its header or markers', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<html><head><title>x</title></head></html>',
      status: 200,
      headers: new Headers({ server: 'nginx' }),
      finalUrl: 'https://example.com/',
    });
    const report = await runAudit('https://example.com');
    expect(report.page).toEqual({ status: 200, finalUrl: 'https://example.com/', nextjs: false });
  });

  it('keeps the status of a non-2xx response', async () => {
    mockFetchPage.mockResolvedValue({
      body: 'Forbidden',
      status: 403,
      headers: new Headers(),
      finalUrl: 'https://example.com/',
    });
    const report = await runAudit('https://example.com');
    expect(report.page).toEqual({ status: 403, finalUrl: 'https://example.com/', nextjs: false });
  });

  it('records nulls when the page could not be fetched', async () => {
    mockFetchPage.mockRejectedValue(new Error('timeout'));
    const report = await runAudit('https://example.com');
    expect(report.page).toEqual({ status: null, finalUrl: null, nextjs: false });
  });

  it('is present on a run limited with only', async () => {
    const report = await runAudit('https://example.com', { only: ['vercel'] });
    expect(report.page).toEqual({ status: 200, finalUrl: 'https://example.com/', nextjs: true });
  });
});

describe('runAudit with only', () => {
  const allMocks = () => ({
    robots: mockRobots,
    redirects: mockRedirects,
    sitemap: mockSitemap,
    metadata: mockMetadata,
    favicon: mockFavicon,
    nextjs: mockNextjs,
    structuredData: mockStructuredData,
    i18n: mockI18n,
    images: mockImages,
    security: mockSecurity,
    performance: mockPerformance,
    vercel: mockVercel,
    streamedMetadata: mockStreamedMetadata,
    hostLeak: mockHostLeak,
    uaParity: mockUaParity,
    crawl: mockCrawl,
  });

  function called(): string[] {
    return Object.entries(allMocks())
      .filter(([, mock]) => mock.mock.calls.length > 0)
      .map(([name]) => name);
  }

  it('runs every module id, in MODULE_IDS order, on a full run with crawl', async () => {
    const report = await runAudit('https://example.com', { crawl: 10 });

    expect(report.modules.map((m) => m.module)).toEqual([...MODULE_IDS]);
    expect(Object.keys(allMocks()).sort()).toEqual([...MODULE_IDS].sort());
  });

  it('treats an empty only as a full run', async () => {
    const report = await runAudit('https://example.com', { only: [] });

    expect(mockMetadata).toHaveBeenCalledTimes(1);
    expect('only' in report).toBe(false);
  });

  it('runs only the selected modules', async () => {
    const report = await runAudit('https://example.com', { only: ['metadata', 'vercel'] });

    expect(called()).toEqual(['metadata', 'vercel']);
    expect(report.modules.map((m) => m.module)).toEqual(['metadata', 'vercel']);
    expect(report.only).toEqual(['metadata', 'vercel']);
    expect(mockFetchPage).toHaveBeenCalledTimes(1);
  });

  it('adds robots when sitemap is selected, so the robots.txt cross-check still runs', async () => {
    mockRobots.mockImplementation(async (ctx) => {
      ctx.robotsTxt = 'Sitemap: https://example.com/other.xml';
      return [];
    });

    const report = await runAudit('https://example.com', { only: ['sitemap'] });

    expect(called()).toEqual(['robots', 'sitemap']);
    expect(mockSitemap.mock.calls[0][0].robotsTxt).toBe('Sitemap: https://example.com/other.xml');
    expect(report.only).toEqual(['robots', 'sitemap']);
  });

  it('adds robots and sitemap when crawl is selected, and runs crawl last', async () => {
    const order: string[] = [];
    mockRobots.mockImplementation(async () => { order.push('robots'); return []; });
    mockSitemap.mockImplementation(async (ctx) => {
      order.push('sitemap');
      ctx.sitemapUrls = ['https://example.com/a'];
      return [];
    });
    mockCrawl.mockImplementation(async (ctx) => {
      order.push('crawl');
      expect(ctx.sitemapUrls).toEqual(['https://example.com/a']);
      return [];
    });

    const report = await runAudit('https://example.com', { only: ['crawl'], crawl: 5 });

    expect(order).toEqual(['robots', 'sitemap', 'crawl']);
    expect(report.only).toEqual(['robots', 'sitemap', 'crawl']);
    expect(report.modules.map((m) => m.module)).toEqual(['robots', 'sitemap', 'crawl']);
  });

  it('runs crawl when it is selected even without the crawl option', async () => {
    await runAudit('https://example.com', { only: ['crawl'] });

    expect(mockCrawl).toHaveBeenCalledTimes(1);
  });

  it('does not run crawl when the crawl option is set but crawl is not selected', async () => {
    await runAudit('https://example.com', { only: ['metadata'], crawl: 10 });

    expect(mockCrawl).not.toHaveBeenCalled();
  });

  it('warns once on stderr when the crawl option is set but crawl is not selected', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const report = await runAudit('https://example.com', { only: ['metadata'], crawl: 10 });
      expect(stderr.mock.calls).toEqual([['--crawl has no effect: "crawl" is not in --only\n']]);
      expect(report.only).toEqual(['metadata']);
    } finally {
      stderr.mockRestore();
    }
  });

  it('does not warn when crawl is selected or only is unset', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await runAudit('https://example.com', { only: ['crawl'], crawl: 10 });
      await runAudit('https://example.com', { crawl: 10 });
      await runAudit('https://example.com', { only: ['metadata'] });
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });

  it('puts every dependency in an earlier phase than the module that needs it', () => {
    const phaseOf = new Map(phases.flatMap((phase, i) => phase.map((m) => [m.name, i] as const)));
    for (const mod of phases.flat()) {
      for (const dep of mod.deps ?? []) expect(phaseOf.get(dep)).toBeLessThan(phaseOf.get(mod.name)!);
    }
  });

  it('counts only the selected modules in the summary', async () => {
    mockMetadata.mockResolvedValue([
      { code: 'TITLE_MISSING', severity: 'error', category: 'metadata', message: '', explanation: '', suggestion: '' },
    ]);
    mockFavicon.mockResolvedValue([
      { code: 'FAVICON_MISSING', severity: 'warning', category: 'favicon', message: '', explanation: '', suggestion: '' },
    ]);

    const report = await runAudit('https://example.com', { only: ['metadata'] });

    expect(report.summary).toEqual({ errors: 1, warnings: 0, info: 0, passed: 0 });
  });

  it('leaves only off the report when nothing is selected', async () => {
    const report = await runAudit('https://example.com');

    expect('only' in report).toBe(false);
  });
});
