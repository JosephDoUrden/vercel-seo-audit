import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditSoft404, dynamicPrefix } from './soft404.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
}));

import { fetchPage } from '../utils/http.js';

const mockFetchPage = vi.mocked(fetchPage);

// A fixed sequence instead of crypto.randomBytes, so the probe URLs are known.
const SEEDS = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)];
function seeded(): () => string {
  let i = 0;
  return () => SEEDS[i++ % SEEDS.length];
}

const ROOT_PROBE = `https://example.com/${SEEDS[0]}`;
const HTML_PROBE = `https://example.com/${SEEDS[2]}.html`;

beforeEach(() => {
  vi.resetAllMocks();
});

function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: { auditedUrl: 'https://example.com/' },
    verbose: false,
    html: '<html><head><title>Home</title></head><body><h1>Home</h1></body></html>',
    finalUrl: 'https://example.com/',
    ...overrides,
  };
}

type Answer = { status: number; body?: string; headers?: Record<string, string>; finalUrl?: string };

// Answers each probe URL from the table; an unlisted URL gets a plain 404.
function serve(table: Record<string, Answer>): void {
  mockFetchPage.mockImplementation(async (url) => {
    const a = table[url] ?? { status: 404 };
    return {
      status: a.status,
      body: a.body ?? '',
      headers: new Headers(a.headers ?? { 'content-type': 'text/html' }),
      finalUrl: a.finalUrl ?? url,
    };
  });
}

const requested = () => mockFetchPage.mock.calls.map(([url]) => url);
const codes = (findings: { code: string }[]) => findings.map((f) => f.code);
const TITLED = { status: 200, body: '<html><head><title>Hi</title></head></html>' };

describe('auditSoft404', () => {
  it('probes nothing when phase 0 left no HTML (unreachable or non-200 page)', async () => {
    const findings = await auditSoft404(makeCtx({ html: undefined }), seeded());
    expect(findings).toEqual([]);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('passes once, listing the probes, when an unknown path answers 404', async () => {
    serve({});
    const findings = await auditSoft404(makeCtx(), seeded());

    expect(requested()).toEqual([ROOT_PROBE]);
    expect(codes(findings)).toEqual(['SOFT_404_NONE']);
    expect(findings[0]).toMatchObject({
      severity: 'pass',
      category: 'indexing',
      details: { probes: [{ probe: 'root', url: ROOT_PROBE, status: 404 }] },
    });
  });

  it('treats 410 as fine too', async () => {
    serve({ [ROOT_PROBE]: { status: 410 } });
    const findings = await auditSoft404(makeCtx(), seeded());
    expect(codes(findings)).toEqual(['SOFT_404_NONE']);
  });

  it('passes the fetch options through, so the private-address guard applies', async () => {
    serve({});
    const ctx = makeCtx();
    await auditSoft404(ctx, seeded());
    expect(mockFetchPage).toHaveBeenCalledWith(ROOT_PROBE, ctx.fetchOptions);
  });

  it('reports a 200 with a robots noindex meta as SOFT_404_NOINDEX (info)', async () => {
    serve({
      [ROOT_PROBE]: {
        status: 200,
        body: '<html><head><meta name="robots" content="noindex"><title>404: This page could not be found.</title></head><body><h1>404</h1></body></html>',
      },
    });
    const findings = await auditSoft404(makeCtx(), seeded());

    expect(codes(findings)).toEqual(['SOFT_404_NOINDEX']);
    expect(findings[0]).toMatchObject({
      severity: 'info',
      details: { probe: 'root', url: ROOT_PROBE, status: 200, noindex: 'meta' },
    });
    expect(findings[0].explanation).toContain('notFound()');
  });

  it('reads noindex from the X-Robots-Tag header as well', async () => {
    serve({
      [ROOT_PROBE]: {
        status: 200,
        body: '<html><head><title>Missing</title></head><body></body></html>',
        headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' },
      },
    });
    const findings = await auditSoft404(makeCtx(), seeded());
    expect(codes(findings)).toEqual(['SOFT_404_NOINDEX']);
    expect(findings[0].details).toMatchObject({ noindex: 'header' });
  });

  it('reports a plain 200 as SOFT_404 (error) and says whether it looks like an error page', async () => {
    serve({
      [ROOT_PROBE]: {
        status: 200,
        body: "<html><head><title>Oops</title></head><body><h1>Sorry, this page doesn't exist</h1></body></html>",
      },
    });
    const findings = await auditSoft404(makeCtx(), seeded());

    expect(codes(findings)).toEqual(['SOFT_404']);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      details: { probe: 'root', url: ROOT_PROBE, status: 200, title: 'Oops', looksLikeErrorPage: true },
    });
  });

  it('marks a 200 that renders ordinary content as not looking like an error page', async () => {
    serve({ [ROOT_PROBE]: { status: 200, body: '<html><head><title>Home</title></head><body><h1>Welcome</h1></body></html>' } });
    const findings = await auditSoft404(makeCtx(), seeded());
    expect(findings[0].details).toMatchObject({ title: 'Home', looksLikeErrorPage: false });
  });

  it('reports the App Router error shell (<html id="__next_error__">) as NEXTJS_ERROR_SHELL', async () => {
    serve({
      [ROOT_PROBE]: {
        status: 200,
        body: '<!DOCTYPE html><html id="__next_error__"><head><meta name="robots" content="noindex"></head><body><script>self.__next_f=[]</script></body></html>',
      },
    });
    const findings = await auditSoft404(makeCtx(), seeded());

    expect(codes(findings)).toEqual(['NEXTJS_ERROR_SHELL']);
    expect(findings[0]).toMatchObject({ severity: 'error', category: 'indexing', details: { probe: 'root', status: 200 } });
  });

  it('reports a body holding only an empty __next root and no <title> as NEXTJS_ERROR_SHELL', async () => {
    serve({
      [ROOT_PROBE]: {
        status: 200,
        body: '<html><head></head><body><div id="__next"></div><script src="/_next/static/chunks/main.js"></script></body></html>',
      },
    });
    const findings = await auditSoft404(makeCtx(), seeded());
    expect(codes(findings)).toEqual(['NEXTJS_ERROR_SHELL']);
  });

  it('does not take a titled page with an __next root for the error shell', async () => {
    serve({
      [ROOT_PROBE]: { status: 200, body: '<html><head><title>Not found</title></head><body><div id="__next"></div></body></html>' },
    });
    const findings = await auditSoft404(makeCtx(), seeded());
    expect(codes(findings)).toEqual(['SOFT_404']);
    expect(findings[0].details).toMatchObject({ looksLikeErrorPage: true });
  });

  it('reports a redirect to the home page as SOFT_404_REDIRECT (warning)', async () => {
    serve({
      [ROOT_PROBE]: { status: 200, body: '<html><head><title>Home</title></head></html>', finalUrl: 'https://example.com/' },
    });
    const findings = await auditSoft404(makeCtx(), seeded());

    expect(codes(findings)).toEqual(['SOFT_404_REDIRECT']);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      details: { probe: 'root', url: ROOT_PROBE, status: 200, finalUrl: 'https://example.com/' },
    });
  });

  it('does not count a redirect that ends in a 404 (a locale or trailing-slash hop)', async () => {
    serve({ [ROOT_PROBE]: { status: 404, finalUrl: `https://example.com/en/${SEEDS[0]}` } });
    const findings = await auditSoft404(makeCtx(), seeded());
    expect(codes(findings)).toEqual(['SOFT_404_NONE']);
  });

  it('reads a trailing-slash hop to a 200 as the probe itself, not a redirect', async () => {
    serve({ [ROOT_PROBE]: { ...TITLED, finalUrl: `${ROOT_PROBE}/` } });
    const findings = await auditSoft404(makeCtx(), seeded());
    expect(codes(findings)).toEqual(['SOFT_404']);
  });

  it('reports a 5xx as SOFT_404_SERVER_ERROR (warning)', async () => {
    serve({ [ROOT_PROBE]: { status: 503 } });
    const findings = await auditSoft404(makeCtx(), seeded());

    expect(codes(findings)).toEqual(['SOFT_404_SERVER_ERROR']);
    expect(findings[0]).toMatchObject({ severity: 'warning', details: { probe: 'root', status: 503 } });
  });

  it('skips a probe that fails to fetch, and reports nothing when every probe failed', async () => {
    mockFetchPage.mockRejectedValue(new Error('Refused to fetch the private address 10.0.0.1'));
    const findings = await auditSoft404(makeCtx(), seeded());
    expect(findings).toEqual([]);
  });

  it('probes under the origin the page redirected to, not the one typed', async () => {
    serve({});
    await auditSoft404(makeCtx({ finalUrl: 'https://www.example.com/' }), seeded());
    expect(requested()).toEqual([`https://www.example.com/${SEEDS[0]}`]);
  });

  describe('with a sitemap', () => {
    const sitemapUrls = [
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/blog/first-post',
      'https://example.com/blog/second-post',
      'https://example.com/blog/third-post',
      'https://example.com/docs/intro',
      'https://example.com/docs/setup',
    ];
    const BLOG_PROBE = `https://example.com/blog/${SEEDS[1]}`;

    it('probes a random slug under the most common dynamic-looking prefix', async () => {
      serve({});
      const findings = await auditSoft404(makeCtx({ sitemapUrls }), seeded());

      expect(requested()).toEqual([ROOT_PROBE, BLOG_PROBE]);
      expect(findings[0].details).toEqual({
        probes: [
          { probe: 'root', url: ROOT_PROBE, status: 404 },
          { probe: 'dynamic', url: BLOG_PROBE, status: 404 },
        ],
      });
    });

    it('runs the .html probe only when the root and dynamic probes both answer 200', async () => {
      serve({ [ROOT_PROBE]: TITLED, [BLOG_PROBE]: TITLED, [HTML_PROBE]: { status: 404 } });
      const findings = await auditSoft404(makeCtx({ sitemapUrls }), seeded());

      expect(requested()).toEqual([ROOT_PROBE, BLOG_PROBE, HTML_PROBE]);
      expect(codes(findings)).toEqual(['SOFT_404', 'SOFT_404']);
      expect(findings.map((f) => f.details?.probe)).toEqual(['root', 'dynamic']);
    });

    it('reports the .html probe too when it also answers 200 (a catch-all rewrite)', async () => {
      serve({ [ROOT_PROBE]: TITLED, [BLOG_PROBE]: TITLED, [HTML_PROBE]: TITLED });
      const findings = await auditSoft404(makeCtx({ sitemapUrls }), seeded());

      expect(findings.map((f) => f.details?.probe)).toEqual(['root', 'dynamic', 'file']);
      expect(mockFetchPage).toHaveBeenCalledTimes(3);
    });

    it('skips the .html probe when only one of the first two answers 200', async () => {
      serve({ [ROOT_PROBE]: TITLED });
      await auditSoft404(makeCtx({ sitemapUrls }), seeded());
      expect(requested()).toEqual([ROOT_PROBE, BLOG_PROBE]);
    });
  });
});

describe('dynamicPrefix', () => {
  const origin = 'https://example.com';

  it('picks the parent path shared by the most URLs with different last segments', () => {
    expect(
      dynamicPrefix(
        ['/docs/a', '/docs/b', '/blog/x', '/blog/y', '/blog/z'].map((p) => origin + p),
        origin,
      ),
    ).toBe('/blog');
  });

  it('keeps nested parents whole', () => {
    expect(dynamicPrefix([`${origin}/shop/shoes/red`, `${origin}/shop/shoes/blue`], origin)).toBe('/shop/shoes');
  });

  it('returns undefined when no parent has two different children', () => {
    expect(dynamicPrefix([`${origin}/`, `${origin}/about`, `${origin}/blog/one`], origin)).toBeUndefined();
    expect(dynamicPrefix([`${origin}/blog/one`, `${origin}/blog/one/`], origin)).toBeUndefined();
    expect(dynamicPrefix(undefined, origin)).toBeUndefined();
  });

  it('ignores URLs on other hosts and ones that do not parse', () => {
    expect(dynamicPrefix(['https://other.com/blog/a', 'https://other.com/blog/b', 'not a url'], origin)).toBeUndefined();
  });

  it('breaks a tie by the prefix seen first', () => {
    expect(dynamicPrefix([`${origin}/b/1`, `${origin}/a/1`, `${origin}/a/2`, `${origin}/b/2`], origin)).toBe('/b');
  });
});
