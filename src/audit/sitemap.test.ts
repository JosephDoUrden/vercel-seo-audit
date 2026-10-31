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

describe('auditSitemap: the checks Google applies when it reads a sitemap', () => {
  const STRICT_CODES = [
    'SITEMAP_MALFORMED_XML',
    'SITEMAP_TOO_MANY_URLS',
    'SITEMAP_RELATIVE_URLS',
    'SITEMAP_LASTMOD_INVALID',
    'SITEMAP_LASTMOD_IDENTICAL',
    'SITEMAP_IGNORED_FIELDS',
    'SITEMAP_INDEX_NESTED',
  ];

  function serve(body: string, extra: { truncated?: boolean } = {}) {
    mockFetchPage.mockResolvedValue({
      body,
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/sitemap.xml',
      ...extra,
    });
  }

  function urlset(urls: Array<{ loc: string; lastmod?: string; changefreq?: string; priority?: string }>) {
    mockParseSitemapXml.mockReturnValue({ type: 'urlset', urls, sitemaps: [] });
  }

  const pages = (n: number, lastmod?: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => ({
      loc: `https://example.com/p/${i}`,
      ...(lastmod ? { lastmod: lastmod(i) } : {}),
    }));

  const codesOf = (findings: { code: string }[]) => findings.map((f) => f.code);

  beforeEach(() => {
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });
  });

  it('raises none of the strict checks for a clean sitemap', async () => {
    serve(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        '<url><loc>https://example.com/search?q=a&amp;page=2</loc><lastmod>2026-10-01</lastmod></url>\n' +
        '<url><loc>https://example.com/caf&#233;&#xE9;</loc><lastmod>2026-10-02T09:30:00+01:00</lastmod></url>\n' +
        '</urlset>\n',
    );
    urlset(pages(12, (i) => `2026-10-${String(i + 1).padStart(2, '0')}T08:00:00Z`));

    const findings = await auditSitemap(makeCtx());

    expect(codesOf(findings).filter((c) => STRICT_CODES.includes(c))).toEqual([]);
    expect(findings.find((f) => f.severity === 'pass')).toBeDefined();
  });

  describe('SITEMAP_MALFORMED_XML', () => {
    it.each([
      ['an unescaped & in a <loc>', '<urlset><url><loc>https://example.com/?a=1&b=2</loc></url></urlset>'],
      ['an unescaped < in a <loc>', '<urlset><url><loc>https://example.com/<b</loc></url></urlset>'],
      ['a missing closing tag', '<urlset><url><loc>https://example.com/</loc></url>'],
      ['an undeclared entity', '<urlset><url><loc>https://example.com/a&nbsp;b</loc></url></urlset>'],
    ])('reports %s once, and still audits the recoverable URLs', async (_label, body) => {
      serve(body);
      urlset([{ loc: 'https://example.com/a' }]);

      const ctx = makeCtx();
      const findings = await auditSitemap(ctx);
      const malformed = findings.filter((f) => f.code === 'SITEMAP_MALFORMED_XML');

      expect(malformed).toHaveLength(1);
      expect(malformed[0]).toMatchObject({
        severity: 'error',
        category: 'sitemap',
        url: 'https://example.com/sitemap.xml',
        details: { line: 1 },
      });
      expect(malformed[0].details!.reason).toEqual(expect.any(String));
      expect(ctx.sitemapUrls).toEqual(['https://example.com/a']);
      expect(mockFetchHead).toHaveBeenCalledWith('https://example.com/a', {});
      // A sitemap with an XML error is not reported as valid.
      expect(findings.find((f) => f.severity === 'pass')).toBeUndefined();
    });

    it('names the undeclared entity and the line it is on', async () => {
      serve('<urlset>\n<url>\n<loc>https://example.com/&eacute;t&eacute;</loc>\n</url>\n</urlset>');
      urlset([{ loc: 'https://example.com/a' }]);

      const findings = await auditSitemap(makeCtx());

      expect(findings.find((f) => f.code === 'SITEMAP_MALFORMED_XML')?.details).toMatchObject({
        line: 3,
        entity: '&eacute;',
      });
    });

    it('accepts an entity the document declares', async () => {
      serve('<!DOCTYPE urlset [<!ENTITY site "example.com">]><urlset><url><loc>https://&site;/a</loc></url></urlset>');
      urlset([{ loc: 'https://example.com/a' }]);

      const findings = await auditSitemap(makeCtx());

      expect(codesOf(findings)).not.toContain('SITEMAP_MALFORMED_XML');
    });

    it('leaves & inside CDATA and comments alone', async () => {
      serve(
        '<urlset><!-- a&b &nbsp; --><url><loc><![CDATA[https://example.com/?a=1&b=2&nbsp;]]></loc></url></urlset>',
      );
      urlset([{ loc: 'https://example.com/?a=1&b=2&nbsp;' }]);

      const findings = await auditSitemap(makeCtx());

      expect(codesOf(findings)).not.toContain('SITEMAP_MALFORMED_XML');
    });

    it('adds where the XML breaks to the invalid-XML finding when even the lenient parse fails', async () => {
      serve('<urlset><url><loc>https://example.com/</loc></url>');
      mockParseSitemapXml.mockImplementation(() => {
        throw new Error('Invalid XML');
      });

      const findings = await auditSitemap(makeCtx());

      expect(codesOf(findings)).toEqual(['SITEMAP_MISSING']);
      expect(findings[0]).toMatchObject({ severity: 'error', details: { line: 1, reason: expect.any(String) } });
    });

    it('does not report a sitemap cut at the body cap as malformed; RESPONSE_TOO_LARGE covers it', async () => {
      serve('<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://exa', { truncated: true });
      urlset([{ loc: 'https://example.com/a' }]);

      const findings = await auditSitemap(makeCtx());

      expect(codesOf(findings)).toContain('RESPONSE_TOO_LARGE');
      expect(codesOf(findings)).not.toContain('SITEMAP_MALFORMED_XML');
    });

    it('checks child sitemaps of an index on their own', async () => {
      mockFetchPage
        .mockResolvedValueOnce({
          body: '<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>',
          status: 200,
          headers: new Headers(),
          finalUrl: 'https://example.com/sitemap.xml',
        })
        .mockResolvedValueOnce({
          body: '<urlset><url><loc>https://example.com/?a=1&b=2</loc></url></urlset>',
          status: 200,
          headers: new Headers(),
          finalUrl: 'https://example.com/s1.xml',
        });
      mockParseSitemapXml
        .mockReturnValueOnce({ type: 'sitemapindex', urls: [], sitemaps: ['https://example.com/s1.xml'] })
        .mockReturnValueOnce({ type: 'urlset', urls: [{ loc: 'https://example.com/?a=1&b=2' }], sitemaps: [] });

      const ctx = makeCtx();
      const findings = await auditSitemap(ctx);
      const malformed = findings.filter((f) => f.code === 'SITEMAP_MALFORMED_XML');

      expect(malformed).toHaveLength(1);
      expect(malformed[0].url).toBe('https://example.com/s1.xml');
      expect(ctx.sitemapUrls).toEqual(['https://example.com/?a=1&b=2']);
    });
  });

  describe('SITEMAP_TOO_MANY_URLS', () => {
    it('reports a file with more than 50,000 URLs', async () => {
      serve('<urlset></urlset>');
      urlset(pages(50_001));

      const findings = await auditSitemap(makeCtx());
      const tooMany = findings.filter((f) => f.code === 'SITEMAP_TOO_MANY_URLS');

      expect(tooMany).toHaveLength(1);
      expect(tooMany[0]).toMatchObject({
        severity: 'error',
        url: 'https://example.com/sitemap.xml',
        details: { count: 50_001, limit: 50_000 },
      });
      expect(findings.find((f) => f.severity === 'pass')).toBeUndefined();
    });

    it('accepts exactly 50,000 URLs', async () => {
      serve('<urlset></urlset>');
      urlset(pages(50_000));

      const findings = await auditSitemap(makeCtx());

      expect(codesOf(findings)).not.toContain('SITEMAP_TOO_MANY_URLS');
    });
  });

  describe('SITEMAP_RELATIVE_URLS', () => {
    it('counts <loc> values that are not absolute URLs and lists five', async () => {
      serve('<urlset></urlset>');
      urlset([
        { loc: 'https://example.com/ok' },
        { loc: '/a' },
        { loc: 'b.html' },
        { loc: '//example.com/c' },
        { loc: 'example.com/d' },
        { loc: '/e' },
        { loc: '/f' },
      ]);

      const findings = await auditSitemap(makeCtx());
      const relative = findings.filter((f) => f.code === 'SITEMAP_RELATIVE_URLS');

      expect(relative).toHaveLength(1);
      expect(relative[0]).toMatchObject({
        severity: 'warning',
        url: 'https://example.com/sitemap.xml',
        details: { count: 6, examples: ['/a', 'b.html', '//example.com/c', 'example.com/d', '/e'] },
      });
    });

    it('checks the <loc> values of a sitemap index too', async () => {
      mockFetchPage
        .mockResolvedValueOnce({
          body: '<sitemapindex></sitemapindex>',
          status: 200,
          headers: new Headers(),
          finalUrl: 'https://example.com/sitemap.xml',
        })
        .mockRejectedValueOnce(new Error('Invalid URL'));
      mockParseSitemapXml.mockReturnValueOnce({ type: 'sitemapindex', urls: [], sitemaps: ['sitemap-1.xml'] });

      const findings = await auditSitemap(makeCtx());

      expect(findings.find((f) => f.code === 'SITEMAP_RELATIVE_URLS')?.details).toEqual({
        count: 1,
        examples: ['sitemap-1.xml'],
      });
    });

    it('leaves off-host absolute URLs to SITEMAP_CROSS_HOST_URLS', async () => {
      serve('<urlset></urlset>');
      urlset([{ loc: 'https://example.com/a' }, { loc: 'https://other.test/b' }]);

      const findings = await auditSitemap(makeCtx());

      expect(codesOf(findings)).toContain('SITEMAP_CROSS_HOST_URLS');
      expect(codesOf(findings)).not.toContain('SITEMAP_RELATIVE_URLS');
    });
  });

  describe('SITEMAP_LASTMOD_INVALID', () => {
    it('counts lastmod values that are not W3C Datetime and lists examples', async () => {
      serve('<urlset></urlset>');
      urlset([
        { loc: 'https://example.com/1', lastmod: '2026-10-01' },
        { loc: 'https://example.com/2', lastmod: '2026-10-01T10:00:00Z' },
        { loc: 'https://example.com/3', lastmod: '2026-10-01T10:00+02:00' },
        { loc: 'https://example.com/4', lastmod: '2026-10-01T10:00:00.123-05:00' },
        { loc: 'https://example.com/5', lastmod: '01/10/2026' },
        { loc: 'https://example.com/6', lastmod: '2026-10-01T10:00:00' },
        { loc: 'https://example.com/7', lastmod: '2026-13-01' },
        { loc: 'https://example.com/8', lastmod: 'Thu, 01 Oct 2026 10:00:00 GMT' },
        { loc: 'https://example.com/9' },
      ]);

      const findings = await auditSitemap(makeCtx());
      const invalid = findings.filter((f) => f.code === 'SITEMAP_LASTMOD_INVALID');

      expect(invalid).toHaveLength(1);
      expect(invalid[0]).toMatchObject({
        severity: 'warning',
        url: 'https://example.com/sitemap.xml',
        details: {
          count: 4,
          examples: ['01/10/2026', '2026-10-01T10:00:00', '2026-13-01', 'Thu, 01 Oct 2026 10:00:00 GMT'],
        },
      });
    });
  });

  describe('SITEMAP_LASTMOD_IDENTICAL', () => {
    it('reports every lastmod in a file of ten or more URLs sharing one second', async () => {
      serve('<urlset></urlset>');
      urlset(pages(10, (i) => `2026-10-31T12:00:00.${String(100 + i)}Z`));

      const findings = await auditSitemap(makeCtx());
      const identical = findings.filter((f) => f.code === 'SITEMAP_LASTMOD_IDENTICAL');

      expect(identical).toHaveLength(1);
      expect(identical[0]).toMatchObject({
        severity: 'info',
        url: 'https://example.com/sitemap.xml',
        details: { count: 10, lastmod: '2026-10-31T12:00:00.100Z' },
      });
      expect(identical[0].explanation).toContain('consistently and verifiably');
      expect(identical[0].suggestion).toContain('new Date()');
    });

    it('compares instants, so one second written in two time zones is still identical', async () => {
      serve('<urlset></urlset>');
      urlset(pages(10, (i) => (i % 2 ? '2026-10-31T12:00:00Z' : '2026-10-31T13:00:00+01:00')));

      const findings = await auditSitemap(makeCtx());

      expect(codesOf(findings)).toContain('SITEMAP_LASTMOD_IDENTICAL');
    });

    it('stays quiet below ten URLs, when one value differs, when one is missing, or for dates without a time', async () => {
      const same = () => '2026-10-31T12:00:00Z';
      for (const urls of [
        pages(9, same),
        pages(10, (i) => (i === 9 ? '2026-10-31T12:00:01Z' : same())),
        [...pages(9, same), { loc: 'https://example.com/no-lastmod' }],
        pages(10, () => '2026-10-31'),
      ]) {
        serve('<urlset></urlset>');
        urlset(urls);

        const findings = await auditSitemap(makeCtx());

        expect(codesOf(findings)).not.toContain('SITEMAP_LASTMOD_IDENTICAL');
      }
    });
  });

  describe('SITEMAP_IGNORED_FIELDS', () => {
    it('reports <priority> and <changefreq> once, across an index and its children', async () => {
      serve('<urlset></urlset>');
      mockParseSitemapXml
        .mockReturnValueOnce({
          type: 'sitemapindex',
          urls: [],
          sitemaps: ['https://example.com/s1.xml', 'https://example.com/s2.xml'],
        })
        .mockReturnValueOnce({
          type: 'urlset',
          urls: [
            { loc: 'https://example.com/a', priority: '0.8' },
            { loc: 'https://example.com/b', changefreq: 'daily', priority: '0.5' },
          ],
          sitemaps: [],
        })
        .mockReturnValueOnce({
          type: 'urlset',
          urls: [{ loc: 'https://example.com/c', changefreq: 'weekly' }],
          sitemaps: [],
        });

      const findings = await auditSitemap(makeCtx());
      const ignored = findings.filter((f) => f.code === 'SITEMAP_IGNORED_FIELDS');

      expect(ignored).toHaveLength(1);
      expect(ignored[0]).toMatchObject({
        severity: 'info',
        url: 'https://example.com/s1.xml',
        details: { priority: 2, changefreq: 1 },
      });
    });
  });

  describe('SITEMAP_INDEX_NESTED', () => {
    it('reports an index that lists another index, and does not follow it', async () => {
      serve('<sitemapindex></sitemapindex>');
      mockParseSitemapXml
        .mockReturnValueOnce({
          type: 'sitemapindex',
          urls: [],
          sitemaps: ['https://example.com/inner-index.xml', 'https://example.com/s1.xml'],
        })
        .mockReturnValueOnce({ type: 'sitemapindex', urls: [], sitemaps: ['https://example.com/deeper.xml'] })
        .mockReturnValueOnce({ type: 'urlset', urls: [{ loc: 'https://example.com/a' }], sitemaps: [] });

      const ctx = makeCtx();
      const findings = await auditSitemap(ctx);
      const nested = findings.filter((f) => f.code === 'SITEMAP_INDEX_NESTED');

      expect(mockFetchPage.mock.calls.map(([u]) => u)).toEqual([
        'https://example.com/sitemap.xml',
        'https://example.com/inner-index.xml',
        'https://example.com/s1.xml',
      ]);
      expect(nested).toHaveLength(1);
      expect(nested[0]).toMatchObject({
        severity: 'warning',
        url: 'https://example.com/sitemap.xml',
        details: { count: 1, examples: ['https://example.com/inner-index.xml'] },
      });
      expect(ctx.sitemapUrls).toEqual(['https://example.com/a']);
    });

    it('reports an index that lists itself', async () => {
      serve('<sitemapindex></sitemapindex>');
      mockParseSitemapXml.mockReturnValue({
        type: 'sitemapindex',
        urls: [],
        sitemaps: ['https://example.com/sitemap.xml'],
      });

      const findings = await auditSitemap(makeCtx());

      expect(mockFetchPage).toHaveBeenCalledTimes(2);
      expect(findings.find((f) => f.code === 'SITEMAP_INDEX_NESTED')?.details).toEqual({
        count: 1,
        examples: ['https://example.com/sitemap.xml'],
      });
    });
  });
});
