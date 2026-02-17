import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditRedirects } from './redirects.js';

vi.mock('../utils/http.js', () => ({
  followRedirectChain: vi.fn(),
  fetchWithoutRedirect: vi.fn(),
  fetchPage: vi.fn(),
}));

vi.mock('../utils/html-parser.js', () => ({
  getMetaRefresh: vi.fn(),
}));

import { followRedirectChain, fetchWithoutRedirect, fetchPage } from '../utils/http.js';
import { getMetaRefresh } from '../utils/html-parser.js';

const mockFollowRedirectChain = vi.mocked(followRedirectChain);
const mockFetchWithoutRedirect = vi.mocked(fetchWithoutRedirect);
const mockFetchPage = vi.mocked(fetchPage);
const mockGetMetaRefresh = vi.mocked(getMetaRefresh);

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

  // Default: no redirect chain, no meta refresh
  mockFollowRedirectChain.mockResolvedValue({
    hops: [],
    finalUrl: 'https://example.com/',
    isCircular: false,
  });
  mockFetchWithoutRedirect.mockResolvedValue({
    status: 200,
    headers: new Headers(),
  } as Response);
  mockFetchPage.mockResolvedValue({
    body: '<html></html>',
    status: 200,
    headers: new Headers(),
    finalUrl: 'https://example.com/',
  });
  mockGetMetaRefresh.mockReturnValue(null);
});

describe('auditRedirects', () => {
  it('detects redirect loop', async () => {
    mockFollowRedirectChain.mockResolvedValueOnce({
      hops: [
        { url: 'https://example.com/', status: 301, location: 'https://example.com/a' },
        { url: 'https://example.com/a', status: 301, location: 'https://example.com/' },
      ],
      finalUrl: 'https://example.com/',
      isCircular: true,
    });

    const findings = await auditRedirects(makeCtx());
    const loop = findings.find((f) => f.code === 'REDIRECT_LOOP');
    expect(loop).toBeDefined();
    expect(loop!.severity).toBe('error');
  });

  it('detects redirect chain with multiple hops', async () => {
    mockFollowRedirectChain.mockResolvedValueOnce({
      hops: [
        { url: 'https://example.com/', status: 301, location: 'https://example.com/a' },
        { url: 'https://example.com/a', status: 301, location: 'https://example.com/b' },
      ],
      finalUrl: 'https://example.com/b',
      isCircular: false,
    });

    const findings = await auditRedirects(makeCtx());
    const chain = findings.find((f) => f.code === 'REDIRECT_CHAIN');
    expect(chain).toBeDefined();
    expect(chain!.severity).toBe('warning');
    expect(chain!.message).toContain('2 hops');
  });

  it('reports pass when HTTP redirects to HTTPS', async () => {
    // First call: homepage chain (no redirect)
    mockFollowRedirectChain.mockResolvedValueOnce({
      hops: [],
      finalUrl: 'https://example.com/',
      isCircular: false,
    });
    // Second call: http -> https check
    mockFollowRedirectChain.mockResolvedValueOnce({
      hops: [{ url: 'http://example.com/', status: 301, location: 'https://example.com/' }],
      finalUrl: 'https://example.com/',
      isCircular: false,
    });

    const findings = await auditRedirects(makeCtx());
    const httpsRedirect = findings.find((f) => f.code === 'HTTP_TO_HTTPS_REDIRECT');
    expect(httpsRedirect).toBeDefined();
    expect(httpsRedirect!.severity).toBe('pass');
  });

  it('reports warning when HTTP does not redirect to HTTPS', async () => {
    mockFollowRedirectChain.mockResolvedValueOnce({
      hops: [],
      finalUrl: 'https://example.com/',
      isCircular: false,
    });
    mockFollowRedirectChain.mockResolvedValueOnce({
      hops: [],
      finalUrl: 'http://example.com/',
      isCircular: false,
    });

    const findings = await auditRedirects(makeCtx());
    const noHttps = findings.find((f) => f.code === 'HTTP_NO_HTTPS_REDIRECT');
    expect(noHttps).toBeDefined();
    expect(noHttps!.severity).toBe('warning');
  });

  it('detects trailing slash redirect', async () => {
    mockFetchWithoutRedirect.mockResolvedValue({
      status: 308,
      headers: new Headers({ location: 'https://example.com/' }),
    } as unknown as Response);

    const findings = await auditRedirects(makeCtx());
    const slash = findings.find((f) => f.code === 'TRAILING_SLASH_REDIRECT');
    expect(slash).toBeDefined();
    expect(slash!.severity).toBe('info');
  });

  it('does not report trailing slash when no redirect', async () => {
    mockFetchWithoutRedirect.mockResolvedValue({
      status: 200,
      headers: new Headers(),
    } as Response);

    const findings = await auditRedirects(makeCtx());
    expect(findings.find((f) => f.code === 'TRAILING_SLASH_REDIRECT')).toBeUndefined();
  });

  it('detects meta refresh redirect', async () => {
    mockGetMetaRefresh.mockReturnValue('https://example.com/new');

    const findings = await auditRedirects(makeCtx());
    const meta = findings.find((f) => f.code === 'META_REFRESH_REDIRECT');
    expect(meta).toBeDefined();
    expect(meta!.severity).toBe('warning');
    expect(meta!.details?.targetUrl).toBe('https://example.com/new');
  });

  it('does not report meta refresh when none detected', async () => {
    mockGetMetaRefresh.mockReturnValue(null);

    const findings = await auditRedirects(makeCtx());
    expect(findings.find((f) => f.code === 'META_REFRESH_REDIRECT')).toBeUndefined();
  });

  it('detects common page redirect chains', async () => {
    // Homepage: no redirect
    mockFollowRedirectChain.mockResolvedValueOnce({
      hops: [],
      finalUrl: 'https://example.com/',
      isCircular: false,
    });
    // HTTP->HTTPS check
    mockFollowRedirectChain.mockResolvedValueOnce({
      hops: [{ url: 'http://example.com/', status: 301, location: 'https://example.com/' }],
      finalUrl: 'https://example.com/',
      isCircular: false,
    });
    // Common page /about: redirect chain
    mockFollowRedirectChain.mockResolvedValueOnce({
      hops: [
        { url: 'https://example.com/about', status: 301, location: 'https://example.com/about-us' },
        { url: 'https://example.com/about-us', status: 301, location: 'https://example.com/about-us/' },
      ],
      finalUrl: 'https://example.com/about-us/',
      isCircular: false,
    });
    // Remaining common pages: no redirect
    mockFollowRedirectChain.mockResolvedValue({
      hops: [],
      finalUrl: 'https://example.com/',
      isCircular: false,
    });

    const findings = await auditRedirects(makeCtx());
    const common = findings.find((f) => f.code === 'COMMON_PAGE_REDIRECT');
    expect(common).toBeDefined();
    expect(common!.severity).toBe('info');
  });

  it('uses custom pages list from ctx', async () => {
    const ctx = makeCtx({ pages: ['/custom-page'] });

    // Homepage chain
    mockFollowRedirectChain.mockResolvedValueOnce({
      hops: [],
      finalUrl: 'https://example.com/',
      isCircular: false,
    });
    // HTTP->HTTPS
    mockFollowRedirectChain.mockResolvedValueOnce({
      hops: [],
      finalUrl: 'https://example.com/',
      isCircular: false,
    });
    // Custom page
    mockFollowRedirectChain.mockResolvedValueOnce({
      hops: [],
      finalUrl: 'https://example.com/custom-page',
      isCircular: false,
    });

    const findings = await auditRedirects(ctx);
    // Should only check /custom-page, not default COMMON_PAGES
    // 3rd call = the custom page
    expect(mockFollowRedirectChain).toHaveBeenCalledWith(
      'https://example.com/custom-page',
      expect.anything(),
    );
  });

  it('handles fetch errors gracefully for HTTP check', async () => {
    mockFollowRedirectChain
      .mockResolvedValueOnce({
        hops: [],
        finalUrl: 'https://example.com/',
        isCircular: false,
      })
      .mockRejectedValueOnce(new Error('Network error')); // HTTP check fails

    const findings = await auditRedirects(makeCtx());
    // Should not throw, no HTTP_TO_HTTPS_REDIRECT or HTTP_NO_HTTPS_REDIRECT
    expect(findings.find((f) => f.code === 'HTTP_TO_HTTPS_REDIRECT')).toBeUndefined();
    expect(findings.find((f) => f.code === 'HTTP_NO_HTTPS_REDIRECT')).toBeUndefined();
  });

  it('handles fetch errors gracefully for trailing slash check', async () => {
    mockFetchWithoutRedirect.mockRejectedValue(new Error('timeout'));

    const findings = await auditRedirects(makeCtx());
    expect(findings.find((f) => f.code === 'TRAILING_SLASH_REDIRECT')).toBeUndefined();
  });

  it('handles fetch errors gracefully for meta refresh check', async () => {
    mockFetchPage.mockRejectedValue(new Error('timeout'));

    const findings = await auditRedirects(makeCtx());
    expect(findings.find((f) => f.code === 'META_REFRESH_REDIRECT')).toBeUndefined();
  });

  it('no findings when everything is clean', async () => {
    // HTTP -> HTTPS success
    mockFollowRedirectChain
      .mockResolvedValueOnce({ hops: [], finalUrl: 'https://example.com/', isCircular: false })
      .mockResolvedValueOnce({
        hops: [{ url: 'http://example.com/', status: 301, location: 'https://example.com/' }],
        finalUrl: 'https://example.com/',
        isCircular: false,
      })
      // Common pages: no redirects
      .mockResolvedValue({ hops: [], finalUrl: 'https://example.com/', isCircular: false });

    const findings = await auditRedirects(makeCtx());
    const nonPass = findings.filter((f) => f.severity !== 'pass' && f.severity !== 'info');
    expect(nonPass).toHaveLength(0);
  });
});
