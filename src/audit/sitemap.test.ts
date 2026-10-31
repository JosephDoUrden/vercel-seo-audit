import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditSitemap } from './sitemap.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
  fetchHead: vi.fn(),
  followRedirectChain: vi.fn(),
}));

vi.mock('../utils/xml-parser.js', () => ({
  parseSitemapXml: vi.fn(),
}));

import { fetchPage, fetchHead, followRedirectChain } from '../utils/http.js';
import { parseSitemapXml } from '../utils/xml-parser.js';

const mockFetchPage = vi.mocked(fetchPage);
const mockFetchHead = vi.mocked(fetchHead);
const mockFollowRedirectChain = vi.mocked(followRedirectChain);
const mockParseSitemapXml = vi.mocked(parseSitemapXml);

function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: {},
    verbose: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();

  mockFollowRedirectChain.mockResolvedValue({
    hops: [],
    finalUrl: 'https://example.com/sitemap.xml',
    isCircular: false,
  });
});

describe('auditSitemap', () => {
  it('reports SITEMAP_REDIRECTED when sitemap is redirected', async () => {
    mockFollowRedirectChain.mockResolvedValue({
      hops: [
        {
          url: 'https://example.com/sitemap.xml',
          status: 301,
          location: 'https://example.com/sitemap-new.xml',
        },
      ],
      finalUrl: 'https://example.com/sitemap-new.xml',
      isCircular: false,
    });
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap-new.xml',
    });
    mockParseSitemapXml.mockReturnValue({ type: 'urlset', urls: [], sitemaps: [] });

    const findings = await auditSitemap(makeCtx());
    const redirected = findings.find((f) => f.code === 'SITEMAP_REDIRECTED');
    expect(redirected).toBeDefined();
    expect(redirected!.severity).toBe('warning');
  });

  it('reports SITEMAP_MISSING when status is not 200', async () => {
    mockFetchPage.mockResolvedValue({
      body: '',
      status: 404,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });

    const findings = await auditSitemap(makeCtx());
    const missing = findings.find((f) => f.code === 'SITEMAP_MISSING');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('warning');
  });

  it('reports SITEMAP_MISSING when fetch throws', async () => {
    mockFetchPage.mockRejectedValue(new Error('Network error'));

    const findings = await auditSitemap(makeCtx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('SITEMAP_MISSING');
  });

  it('reports SITEMAP_MISSING with error severity for invalid XML', async () => {
    mockFetchPage.mockResolvedValue({
      body: 'not xml',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockImplementation(() => {
      throw new Error('Invalid XML');
    });

    const findings = await auditSitemap(makeCtx());
    const invalid = findings.find((f) => f.message.includes('invalid XML'));
    expect(invalid).toBeDefined();
    expect(invalid!.severity).toBe('error');
  });

  it('handles sitemapindex correctly', async () => {
    mockFetchPage
      .mockResolvedValueOnce({
        body: '<sitemapindex></sitemapindex>',
        status: 200,
        headers: new Headers(),
        finalUrl: 'https://example.com/sitemap.xml',
      })
      .mockResolvedValueOnce({
        body: '<urlset></urlset>',
        status: 200,
        headers: new Headers(),
        finalUrl: 'https://example.com/sitemap-1.xml',
      });
    mockParseSitemapXml
      .mockReturnValueOnce({
        type: 'sitemapindex',
        urls: [],
        sitemaps: ['https://example.com/sitemap-1.xml'],
      })
      .mockReturnValueOnce({
        type: 'urlset',
        urls: [{ loc: 'https://example.com/page-1' }],
        sitemaps: [],
      });

    const ctx = makeCtx();
    const findings = await auditSitemap(ctx);
    const pass = findings.find((f) => f.severity === 'pass');
    expect(pass).toBeDefined();
    expect(pass!.message).toContain('1 sitemap');
    expect(ctx.sitemapUrls).toEqual(['https://example.com/page-1']);
  });

  it('reports SITEMAP_EMPTY for empty sitemap', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockReturnValue({ type: 'urlset', urls: [], sitemaps: [] });

    const findings = await auditSitemap(makeCtx());
    const empty = findings.find((f) => f.code === 'SITEMAP_EMPTY');
    expect(empty).toBeDefined();
    expect(empty!.severity).toBe('warning');
  });

  it('reports SITEMAP_URL_ERROR for broken URLs', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockReturnValue({
      type: 'urlset',
      urls: [{ loc: 'https://example.com/broken' }],
      sitemaps: [],
    });
    mockFetchHead.mockResolvedValue({ status: 404, headers: new Headers() });

    const findings = await auditSitemap(makeCtx());
    const urlError = findings.find((f) => f.code === 'SITEMAP_URL_ERROR');
    expect(urlError).toBeDefined();
    expect(urlError!.severity).toBe('warning');
  });

  it('reports pass for valid sitemap with accessible URLs', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockReturnValue({
      type: 'urlset',
      urls: [{ loc: 'https://example.com/page-1' }],
      sitemaps: [],
    });
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });

    const findings = await auditSitemap(makeCtx());
    const pass = findings.find((f) => f.severity === 'pass');
    expect(pass).toBeDefined();
    expect(pass!.message).toContain('1 URLs');
  });

  it('reports SITEMAP_ROBOTS_MISMATCH when robots.txt has different sitemap', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockReturnValue({
      type: 'urlset',
      urls: [{ loc: 'https://example.com/page-1' }],
      sitemaps: [],
    });
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });

    const ctx = makeCtx({
      robotsTxt: 'User-agent: *\nSitemap: https://example.com/other-sitemap.xml\n',
    });
    const findings = await auditSitemap(ctx);
    const mismatch = findings.find((f) => f.code === 'SITEMAP_ROBOTS_MISMATCH');
    expect(mismatch).toBeDefined();
    expect(mismatch!.severity).toBe('info');
  });

  it('does not report mismatch when robots.txt sitemap matches', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockReturnValue({
      type: 'urlset',
      urls: [{ loc: 'https://example.com/page-1' }],
      sitemaps: [],
    });
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });

    const ctx = makeCtx({
      robotsTxt: 'Sitemap: https://example.com/sitemap.xml\n',
    });
    const findings = await auditSitemap(ctx);
    expect(findings.find((f) => f.code === 'SITEMAP_ROBOTS_MISMATCH')).toBeUndefined();
  });

  it('stores sitemapUrls on ctx for urlset', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockReturnValue({
      type: 'urlset',
      urls: [
        { loc: 'https://example.com/a' },
        { loc: 'https://example.com/b' },
      ],
      sitemaps: [],
    });
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });

    const ctx = makeCtx();
    await auditSitemap(ctx);
    expect(ctx.sitemapUrls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('handles fetch error for individual sitemap URLs gracefully', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockReturnValue({
      type: 'urlset',
      urls: [
        { loc: 'https://example.com/ok' },
        { loc: 'https://example.com/fail' },
      ],
      sitemaps: [],
    });
    mockFetchHead
      .mockResolvedValueOnce({ status: 200, headers: new Headers() })
      .mockRejectedValueOnce(new Error('Network'));

    const findings = await auditSitemap(makeCtx());
    // Should still produce a pass finding since only 1 URL had errors and network errors are skipped
    const pass = findings.find((f) => f.severity === 'pass');
    expect(pass).toBeDefined();
  });

  it('handles unreachable child sitemaps in sitemapindex', async () => {
    mockFetchPage
      .mockResolvedValueOnce({
        body: '<sitemapindex></sitemapindex>',
        status: 200,
        headers: new Headers(),
        finalUrl: 'https://example.com/sitemap.xml',
      })
      .mockRejectedValueOnce(new Error('Network'));
    mockParseSitemapXml.mockReturnValueOnce({
      type: 'sitemapindex',
      urls: [],
      sitemaps: ['https://example.com/sitemap-1.xml'],
    });

    const ctx = makeCtx();
    const findings = await auditSitemap(ctx);
    expect(ctx.sitemapUrls).toEqual([]);
    expect(findings.find((f) => f.severity === 'pass')).toBeDefined();
  });

  it('reports EDGE_CHALLENGE instead of SITEMAP_MISSING when the sitemap is challenged', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<html>challenge</html>',
      status: 403,
      headers: new Headers({ 'cf-mitigated': 'challenge' }),
      finalUrl: 'https://example.com/sitemap.xml',
    });

    const findings = await auditSitemap(makeCtx());
    expect(findings.map((f) => f.code)).toEqual(['EDGE_CHALLENGE']);
    expect(findings[0].category).toBe('sitemap');
    expect(findings[0].url).toBe('https://example.com/sitemap.xml');
    expect(findings[0].details).toEqual({ status: 403, provider: 'cloudflare', header: 'cf-mitigated' });
  });

  it('never fetches off-host URLs and reports them once as SITEMAP_CROSS_HOST_URLS', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockReturnValue({
      type: 'urlset',
      urls: [
        { loc: 'https://example.com/a' },
        { loc: 'http://example.com/b' },
        ...Array.from({ length: 6 }, (_, i) => ({ loc: `https://other.example.net/${i}` })),
        { loc: 'http://169.254.169.254/latest/meta-data/' },
      ],
      sitemaps: [],
    });
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });

    const ctx = makeCtx();
    const findings = await auditSitemap(ctx);
    const cross = findings.filter((f) => f.code === 'SITEMAP_CROSS_HOST_URLS');

    expect(mockFetchHead.mock.calls.map(([u]) => u)).toEqual(['https://example.com/a', 'http://example.com/b']);
    expect(ctx.sitemapUrls).toEqual(['https://example.com/a', 'http://example.com/b']);
    expect(cross).toHaveLength(1);
    expect(cross[0]).toMatchObject({
      severity: 'warning',
      category: 'sitemap',
      url: 'https://example.com/sitemap.xml',
      details: {
        count: 7,
        examples: [0, 1, 2, 3, 4].map((i) => `https://other.example.net/${i}`),
      },
    });
    expect(findings.find((f) => f.severity === 'pass')?.message).toContain('9 URLs (2 sampled');
  });

  it('accepts URLs on the host the site redirected to', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockReturnValue({
      type: 'urlset',
      urls: [{ loc: 'https://www.example.com/a' }],
      sitemaps: [],
    });
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });

    const ctx = makeCtx({ finalUrl: 'https://www.example.com/' });
    const findings = await auditSitemap(ctx);

    expect(findings.find((f) => f.code === 'SITEMAP_CROSS_HOST_URLS')).toBeUndefined();
    expect(ctx.sitemapUrls).toEqual(['https://www.example.com/a']);
  });

  it('reports no pass when every URL is off-host', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockReturnValue({
      type: 'urlset',
      urls: [{ loc: 'https://elsewhere.test/a' }],
      sitemaps: [],
    });

    const findings = await auditSitemap(makeCtx());

    expect(mockFetchHead).not.toHaveBeenCalled();
    expect(findings.map((f) => f.code)).toEqual(['SITEMAP_CROSS_HOST_URLS']);
  });

  it('does not fetch off-host child sitemaps, and drops off-host URLs inside the others', async () => {
    mockFetchPage
      .mockResolvedValueOnce({
        body: '<sitemapindex></sitemapindex>',
        status: 200,
        headers: new Headers(),
        finalUrl: 'https://example.com/sitemap.xml',
      })
      .mockResolvedValueOnce({
        body: '<urlset></urlset>',
        status: 200,
        headers: new Headers(),
        finalUrl: 'https://example.com/sitemap-1.xml',
      });
    mockParseSitemapXml
      .mockReturnValueOnce({
        type: 'sitemapindex',
        urls: [],
        sitemaps: ['http://10.0.0.1/internal.xml', 'https://example.com/sitemap-1.xml'],
      })
      .mockReturnValueOnce({
        type: 'urlset',
        urls: [{ loc: 'https://example.com/a' }, { loc: 'https://cdn.test/b' }],
        sitemaps: [],
      });

    const ctx = makeCtx();
    const findings = await auditSitemap(ctx);

    expect(mockFetchPage.mock.calls.map(([u]) => u)).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/sitemap-1.xml',
    ]);
    expect(ctx.sitemapUrls).toEqual(['https://example.com/a']);
    expect(findings.find((f) => f.code === 'SITEMAP_CROSS_HOST_URLS')?.details).toEqual({
      count: 2,
      examples: ['http://10.0.0.1/internal.xml', 'https://cdn.test/b'],
    });
  });

  it('does not count a private address the sitemap tried to redirect to as the site host', async () => {
    mockFollowRedirectChain.mockResolvedValue({
      hops: [{ url: 'https://example.com/sitemap.xml', status: 302, location: 'http://10.0.0.1/sitemap.xml' }],
      finalUrl: 'http://10.0.0.1/sitemap.xml',
      isCircular: false,
    });
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockReturnValue({
      type: 'urlset',
      urls: [{ loc: 'http://10.0.0.1/admin' }, { loc: 'https://example.com/a' }],
      sitemaps: [],
    });
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });

    const ctx = makeCtx();
    const findings = await auditSitemap(ctx);

    expect(mockFetchHead.mock.calls.map(([u]) => u)).toEqual(['https://example.com/a']);
    expect(ctx.sitemapUrls).toEqual(['https://example.com/a']);
    expect(findings.find((f) => f.code === 'SITEMAP_CROSS_HOST_URLS')?.details).toMatchObject({ count: 1 });
  });

  it('reads sitemaps up to MAX_SITEMAP_BYTES, through the shared cache', async () => {
    const cache = new Map();
    mockFetchPage.mockResolvedValue({
      body: '<urlset></urlset>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
    });
    mockParseSitemapXml.mockReturnValue({ type: 'urlset', urls: [], sitemaps: [] });

    await auditSitemap(makeCtx({ fetchOptions: { cache } }));

    expect(mockFetchPage.mock.calls[0][1]).toEqual({ cache, maxBytes: 50_000_000 });
  });

  it('reports RESPONSE_TOO_LARGE when the sitemap was cut at the body cap', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<urlset><url><loc>https://exa',
      status: 200,
      headers: new Headers({ 'content-length': '73400320' }),
      finalUrl: 'https://example.com/sitemap.xml',
      truncated: true,
    });
    mockParseSitemapXml.mockImplementation(() => {
      throw new Error('unclosed tag');
    });

    const findings = await auditSitemap(makeCtx());
    const large = findings.find((f) => f.code === 'RESPONSE_TOO_LARGE');

    expect(large).toMatchObject({
      severity: 'warning',
      category: 'sitemap',
      url: 'https://example.com/sitemap.xml',
      details: { bytes: 73400320, limit: 50_000_000 },
    });
  });

  it('reports RESPONSE_TOO_LARGE for a child sitemap that was cut', async () => {
    mockFetchPage
      .mockResolvedValueOnce({
        body: '<sitemapindex></sitemapindex>',
        status: 200,
        headers: new Headers(),
        finalUrl: 'https://example.com/sitemap.xml',
      })
      .mockResolvedValueOnce({
        body: '<urlset>',
        status: 200,
        headers: new Headers(),
        finalUrl: 'https://example.com/sitemap-1.xml',
        truncated: true,
      });
    mockParseSitemapXml
      .mockReturnValueOnce({ type: 'sitemapindex', urls: [], sitemaps: ['https://example.com/sitemap-1.xml'] })
      .mockReturnValueOnce({ type: 'urlset', urls: [{ loc: 'https://example.com/a' }], sitemaps: [] });

    const findings = await auditSitemap(makeCtx());
    const large = findings.find((f) => f.code === 'RESPONSE_TOO_LARGE');

    expect(large).toMatchObject({ url: 'https://example.com/sitemap-1.xml', details: { bytes: null } });
  });
});
