import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditMetadata } from './metadata.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
  fetchHead: vi.fn(),
}));

import { fetchPage, fetchHead } from '../utils/http.js';

const mockFetchPage = vi.mocked(fetchPage);
const mockFetchHead = vi.mocked(fetchHead);

function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: {},
    verbose: false,
    ...overrides,
  };
}

function makePage(html: string, opts: { headers?: Headers; finalUrl?: string } = {}) {
  return {
    body: html,
    status: 200,
    headers: opts.headers ?? new Headers(),
    finalUrl: opts.finalUrl ?? 'https://example.com/',
  };
}

const FULL_HTML = `<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Example</title>
  <meta name="description" content="A description">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://example.com/">
  <meta property="og:title" content="Example">
  <meta property="og:description" content="A description">
  <meta property="og:image" content="https://example.com/image.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="https://example.com/twitter.png">
</head><body></body></html>`;

beforeEach(() => {
  vi.resetAllMocks();
  mockFetchPage.mockResolvedValue(makePage(FULL_HTML));
  mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });
});

describe('auditMetadata', () => {
  it('returns no errors/warnings for fully complete page', async () => {
    const findings = await auditMetadata(makeCtx());
    const issues = findings.filter((f) => f.severity === 'error' || f.severity === 'warning');
    expect(issues).toHaveLength(0);
  });

  it('returns empty findings when fetch fails', async () => {
    mockFetchPage.mockRejectedValue(new Error('timeout'));
    const findings = await auditMetadata(makeCtx());
    expect(findings).toHaveLength(0);
  });

  it('detects NOINDEX_DETECTED', async () => {
    mockFetchPage.mockResolvedValue(
      makePage('<html><head><meta name="robots" content="noindex"></head><body></body></html>'),
    );
    const findings = await auditMetadata(makeCtx());
    const noindex = findings.find((f) => f.code === 'NOINDEX_DETECTED');
    expect(noindex).toBeDefined();
    expect(noindex!.severity).toBe('error');
  });

  it('detects NOINDEX_DETECTED when the meta name is upper-case', async () => {
    mockFetchPage.mockResolvedValue(
      makePage('<html><head><meta name="ROBOTS" content="NOINDEX"></head><body></body></html>'),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'NOINDEX_DETECTED')).toBeDefined();
  });

  it('detects NOINDEX_DETECTED for a robots meta of none', async () => {
    mockFetchPage.mockResolvedValue(
      makePage('<html><head><meta name="robots" content="none"></head><body></body></html>'),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'NOINDEX_DETECTED')).toBeDefined();
  });

  it('detects X_ROBOTS_NOINDEX header', async () => {
    const headers = new Headers({ 'x-robots-tag': 'noindex' });
    mockFetchPage.mockResolvedValue(makePage(FULL_HTML, { headers }));
    const findings = await auditMetadata(makeCtx());
    const xRobots = findings.find((f) => f.code === 'X_ROBOTS_NOINDEX');
    expect(xRobots).toBeDefined();
    expect(xRobots!.severity).toBe('error');
  });

  it('detects CANONICAL_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>T</title></head><body></body></html>',
      ),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'CANONICAL_MISSING')).toBeDefined();
  });

  it('detects CANONICAL_MISMATCH', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        '<html><head><link rel="canonical" href="https://example.com/other"><meta charset="utf-8"><meta name="viewport" content="w"><title>T</title></head><body></body></html>',
      ),
    );
    const findings = await auditMetadata(makeCtx());
    const mismatch = findings.find((f) => f.code === 'CANONICAL_MISMATCH');
    expect(mismatch).toBeDefined();
    expect(mismatch!.severity).toBe('warning');
  });

  it('detects CANONICAL_EXTERNAL', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        '<html><head><link rel="canonical" href="https://other-domain.com/"><meta charset="utf-8"><meta name="viewport" content="w"><title>T</title></head><body></body></html>',
      ),
    );
    const findings = await auditMetadata(makeCtx());
    const external = findings.find((f) => f.code === 'CANONICAL_EXTERNAL');
    expect(external).toBeDefined();
    expect(external!.severity).toBe('info');
  });

  it('detects CHARSET_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        '<html><head><meta name="viewport" content="w"><title>T</title><link rel="canonical" href="https://example.com/"></head><body></body></html>',
      ),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'CHARSET_MISSING')).toBeDefined();
  });

  it('detects VIEWPORT_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        '<html><head><meta charset="utf-8"><title>T</title><link rel="canonical" href="https://example.com/"></head><body></body></html>',
      ),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'VIEWPORT_MISSING')).toBeDefined();
  });

  it('detects TITLE_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        '<html><head><meta charset="utf-8"><meta name="viewport" content="w"><link rel="canonical" href="https://example.com/"></head><body></body></html>',
      ),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'TITLE_MISSING')).toBeDefined();
  });

  it('detects DESCRIPTION_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(FULL_HTML.replace('<meta name="description" content="A description">', '')),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'DESCRIPTION_MISSING')).toBeDefined();
  });

  it('detects OG_TITLE_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(FULL_HTML.replace('<meta property="og:title" content="Example">', '')),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'OG_TITLE_MISSING')).toBeDefined();
  });

  it('detects OG_DESCRIPTION_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(FULL_HTML.replace('<meta property="og:description" content="A description">', '')),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'OG_DESCRIPTION_MISSING')).toBeDefined();
  });

  it('detects OG_IMAGE_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        FULL_HTML.replace(
          '<meta property="og:image" content="https://example.com/image.png">',
          '',
        ),
      ),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'OG_IMAGE_MISSING')).toBeDefined();
  });

  it('detects OG_IMAGE_RELATIVE', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        FULL_HTML.replace(
          '<meta property="og:image" content="https://example.com/image.png">',
          '<meta property="og:image" content="/image.png">',
        ),
      ),
    );
    const findings = await auditMetadata(makeCtx());
    const relative = findings.find((f) => f.code === 'OG_IMAGE_RELATIVE');
    expect(relative).toBeDefined();
    expect(relative!.severity).toBe('warning');
  });

  it('detects OG_IMAGE_BROKEN when HEAD returns non-2xx', async () => {
    mockFetchHead.mockResolvedValue({ status: 404, headers: new Headers() });
    const findings = await auditMetadata(makeCtx());
    const broken = findings.find((f) => f.code === 'OG_IMAGE_BROKEN');
    expect(broken).toBeDefined();
    expect(broken!.severity).toBe('warning');
    expect(broken!.message).toContain('404');
  });

  it('detects OG_IMAGE_BROKEN when HEAD request fails', async () => {
    mockFetchHead.mockRejectedValue(new Error('timeout'));
    const findings = await auditMetadata(makeCtx());
    const broken = findings.find((f) => f.code === 'OG_IMAGE_BROKEN');
    expect(broken).toBeDefined();
    expect(broken!.message).toContain('could not be fetched');
  });

  it('does not report OG_IMAGE_BROKEN when image returns 200', async () => {
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'OG_IMAGE_BROKEN')).toBeUndefined();
  });

  it('detects TWITTER_CARD_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        FULL_HTML.replace('<meta name="twitter:card" content="summary_large_image">', ''),
      ),
    );
    const findings = await auditMetadata(makeCtx());
    const missing = findings.find((f) => f.code === 'TWITTER_CARD_MISSING');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('info');
  });

  it('detects TWITTER_IMAGE_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        FULL_HTML.replace('<meta name="twitter:image" content="https://example.com/twitter.png">', ''),
      ),
    );
    const findings = await auditMetadata(makeCtx());
    const missing = findings.find((f) => f.code === 'TWITTER_IMAGE_MISSING');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('info');
  });

  it('detects TWITTER_IMAGE_BROKEN when HEAD returns non-2xx', async () => {
    mockFetchHead.mockImplementation(async (url: string) => {
      if (url.includes('twitter')) return { status: 403, headers: new Headers() };
      return { status: 200, headers: new Headers() };
    });
    const findings = await auditMetadata(makeCtx());
    const broken = findings.find((f) => f.code === 'TWITTER_IMAGE_BROKEN');
    expect(broken).toBeDefined();
    expect(broken!.severity).toBe('warning');
    expect(broken!.message).toContain('403');
  });

  it('detects TWITTER_IMAGE_BROKEN when HEAD request fails', async () => {
    mockFetchHead.mockImplementation(async (url: string) => {
      if (url.includes('twitter')) throw new Error('timeout');
      return { status: 200, headers: new Headers() };
    });
    const findings = await auditMetadata(makeCtx());
    const broken = findings.find((f) => f.code === 'TWITTER_IMAGE_BROKEN');
    expect(broken).toBeDefined();
    expect(broken!.message).toContain('could not be fetched');
  });

  it('stores html and headers on ctx', async () => {
    const ctx = makeCtx();
    await auditMetadata(ctx);
    expect(ctx.html).toBeDefined();
    expect(ctx.headers).toBeDefined();
  });

  it('does not report canonical mismatch when canonical matches page URL', async () => {
    mockFetchPage.mockResolvedValue(makePage(FULL_HTML));
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'CANONICAL_MISMATCH')).toBeUndefined();
  });

  it('uses the shared page from ctx instead of fetching', async () => {
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });
    const ctx = makeCtx({
      html: FULL_HTML,
      headers: { 'x-robots-tag': 'noindex' },
      finalUrl: 'https://example.com/',
    });

    const findings = await auditMetadata(ctx);

    expect(mockFetchPage).not.toHaveBeenCalled();
    expect(findings.find((f) => f.code === 'X_ROBOTS_NOINDEX')).toBeDefined();
    expect(findings.find((f) => f.code === 'CANONICAL_MISMATCH')).toBeUndefined();
  });

  it('resolves canonical against ctx.finalUrl when the shared page was redirected', async () => {
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });
    const ctx = makeCtx({
      html: '<html><head><link rel="canonical" href="/"></head></html>',
      headers: {},
      finalUrl: 'https://www.example.com/',
    });

    const findings = await auditMetadata(ctx);
    const mismatch = findings.find((f) => f.code === 'CANONICAL_MISMATCH');

    expect(mockFetchPage).not.toHaveBeenCalled();
    expect(mismatch).toBeUndefined();
  });

  it('does not probe og:image or twitter:image URLs on a private address', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        FULL_HTML.replace('https://example.com/image.png', 'http://169.254.169.254/latest/meta-data/').replace(
          'https://example.com/twitter.png',
          'http://10.0.0.1/t.png',
        ),
      ),
    );

    const findings = await auditMetadata(makeCtx());

    expect(mockFetchHead).not.toHaveBeenCalled();
    expect(findings.map((f) => f.code)).not.toContain('OG_IMAGE_BROKEN');
    expect(findings.map((f) => f.code)).not.toContain('TWITTER_IMAGE_BROKEN');
  });
});

describe('auditMetadata canonical integrity', () => {
  const HEAD_REST = '<meta charset="utf-8"><meta name="viewport" content="w"><title>T</title>';
  const NEW_CODES = [
    'CANONICAL_MULTIPLE',
    'CANONICAL_IN_BODY',
    'CANONICAL_HEADER_CONFLICT',
    'CANONICAL_RELATIVE',
    'CANONICAL_TARGET_NOT_OK',
    'CANONICAL_NOINDEX_CONFLICT',
  ];

  function shared(html: string, headers: Record<string, string> = {}) {
    return makeCtx({ html, headers, finalUrl: 'https://example.com/' });
  }

  function page(head: string, body = ''): string {
    return `<html><head>${HEAD_REST}${head}</head><body>${body}</body></html>`;
  }

  function codes(findings: Awaited<ReturnType<typeof auditMetadata>>): string[] {
    return findings.map((f) => f.code);
  }

  // Every GET answers with `result`, at the URL asked for unless `finalUrl` says otherwise.
  function target(result: { status?: number; finalUrl?: string; body?: string; headers?: Headers }) {
    mockFetchPage.mockImplementation(async (url) => ({
      body: result.body ?? '<html><head></head><body></body></html>',
      status: result.status ?? 200,
      headers: result.headers ?? new Headers(),
      finalUrl: result.finalUrl ?? url,
    }));
  }

  it('raises none of the canonical integrity codes on a clean page and makes no extra request', async () => {
    const findings = await auditMetadata(shared(FULL_HTML, { link: '<https://example.com/>; rel="canonical"' }));
    expect(codes(findings).filter((c) => NEW_CODES.includes(c))).toEqual([]);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  describe('CANONICAL_MULTIPLE', () => {
    it('is raised when the canonicals name different URLs', async () => {
      target({});
      const findings = await auditMetadata(
        shared(page('<link rel="canonical" href="https://example.com/"><link rel="canonical" href="https://example.com/b">')),
      );
      const multiple = findings.find((f) => f.code === 'CANONICAL_MULTIPLE');
      expect(multiple?.severity).toBe('error');
      expect(multiple?.details).toEqual({ hrefs: ['https://example.com/', 'https://example.com/b'] });
    });

    it('is not raised for the same URL written twice', async () => {
      const findings = await auditMetadata(
        shared(page('<link rel="canonical" href="https://example.com/"><link rel="canonical" href="/">')),
      );
      expect(codes(findings)).not.toContain('CANONICAL_MULTIPLE');
    });
  });

  describe('CANONICAL_IN_BODY', () => {
    it('is raised when the only canonical is in <body>', async () => {
      const findings = await auditMetadata(shared(page('', '<p>x</p><link rel="canonical" href="https://example.com/">')));
      const inBody = findings.find((f) => f.code === 'CANONICAL_IN_BODY');
      expect(inBody?.severity).toBe('error');
      expect(inBody?.details).toEqual({ hrefs: ['https://example.com/'] });
      expect(codes(findings)).not.toContain('CANONICAL_MISSING');
    });

    it('is not raised when a canonical is also in <head>', async () => {
      const findings = await auditMetadata(
        shared(page('<link rel="canonical" href="https://example.com/">', '<p>x</p><link rel="canonical" href="https://example.com/">')),
      );
      expect(codes(findings)).not.toContain('CANONICAL_IN_BODY');
    });

    it('is left to the streamed metadata check on a Next.js page', async () => {
      const findings = await auditMetadata(
        shared(page('', '<p>x</p><link rel="canonical" href="https://example.com/">'), { 'x-powered-by': 'Next.js' }),
      );
      expect(codes(findings)).not.toContain('CANONICAL_IN_BODY');
    });
  });

  describe('CANONICAL_HEADER_CONFLICT', () => {
    it('is raised when the Link header names a different URL than the tag', async () => {
      const findings = await auditMetadata(shared(FULL_HTML, { link: '<https://example.com/other>; rel="canonical"' }));
      const conflict = findings.find((f) => f.code === 'CANONICAL_HEADER_CONFLICT');
      expect(conflict?.severity).toBe('warning');
      expect(conflict?.details).toEqual({ header: 'https://example.com/other', tag: 'https://example.com/' });
    });

    it('finds the canonical among other links in the header', async () => {
      const findings = await auditMetadata(
        shared(FULL_HTML, {
          link: '</style.css>; rel=preload; as=style, <https://example.com/a,b>; title="x, y"; rel="alternate CANONICAL"',
        }),
      );
      const conflict = findings.find((f) => f.code === 'CANONICAL_HEADER_CONFLICT');
      expect(conflict?.details).toEqual({ header: 'https://example.com/a,b', tag: 'https://example.com/' });
    });

    it('is not raised when the header and the tag agree', async () => {
      const findings = await auditMetadata(shared(FULL_HTML, { link: '<https://example.com/>; rel=canonical' }));
      expect(codes(findings)).not.toContain('CANONICAL_HEADER_CONFLICT');
    });

    it('uses the header as the canonical when there is no tag', async () => {
      target({});
      const findings = await auditMetadata(shared(page(''), { link: '<https://example.com/other>; rel="canonical"' }));
      expect(codes(findings)).not.toContain('CANONICAL_MISSING');
      expect(codes(findings)).not.toContain('CANONICAL_HEADER_CONFLICT');
      expect(findings.find((f) => f.code === 'CANONICAL_MISMATCH')?.details).toEqual({
        canonical: 'https://example.com/other',
        pageUrl: 'https://example.com/',
      });
    });

    it('ignores a header link whose canonical is only in another param', async () => {
      const findings = await auditMetadata(shared(page(''), { link: '<https://example.com/x>; title="rel=canonical"' }));
      expect(codes(findings)).toContain('CANONICAL_MISSING');
    });
  });

  describe('CANONICAL_RELATIVE', () => {
    it('is raised for a relative href, which is still resolved for the other checks', async () => {
      const findings = await auditMetadata(shared(page('<link rel="canonical" href="/">')));
      const relative = findings.find((f) => f.code === 'CANONICAL_RELATIVE');
      expect(relative?.severity).toBe('warning');
      expect(relative?.details).toEqual({ href: '/', resolved: 'https://example.com/', kind: 'relative' });
      expect(codes(findings)).not.toContain('CANONICAL_MISMATCH');
    });

    it('is raised for a fragment', async () => {
      const findings = await auditMetadata(shared(page('<link rel="canonical" href="https://example.com/#top">')));
      expect(findings.find((f) => f.code === 'CANONICAL_RELATIVE')?.details).toMatchObject({ kind: 'fragment' });
    });

    it('is raised for a protocol-relative href', async () => {
      const findings = await auditMetadata(shared(page('<link rel="canonical" href="//example.com/">')));
      expect(findings.find((f) => f.code === 'CANONICAL_RELATIVE')?.details).toMatchObject({ kind: 'relative' });
    });

    it('is not raised for an absolute href', async () => {
      const findings = await auditMetadata(shared(FULL_HTML));
      expect(codes(findings)).not.toContain('CANONICAL_RELATIVE');
    });
  });

  describe('CANONICAL_TARGET_NOT_OK', () => {
    const OTHER = page('<link rel="canonical" href="https://example.com/other">');

    it('is raised when the target answers non-200', async () => {
      target({ status: 404 });
      const findings = await auditMetadata(shared(OTHER));
      const notOk = findings.find((f) => f.code === 'CANONICAL_TARGET_NOT_OK');
      expect(notOk?.severity).toBe('warning');
      expect(notOk?.details).toEqual({ canonical: 'https://example.com/other', status: 404, noindex: false });
      expect(mockFetchPage).toHaveBeenCalledTimes(1);
      expect(mockFetchPage).toHaveBeenCalledWith('https://example.com/other', {});
    });

    it('is raised when the target redirects', async () => {
      target({ finalUrl: 'https://example.com/elsewhere' });
      const findings = await auditMetadata(shared(OTHER));
      expect(findings.find((f) => f.code === 'CANONICAL_TARGET_NOT_OK')?.details).toMatchObject({
        status: 200,
        redirectedTo: 'https://example.com/elsewhere',
      });
    });

    it('is raised when the target carries a noindex meta tag', async () => {
      target({ body: '<html><head><meta name="robots" content="noindex"></head><body></body></html>' });
      const findings = await auditMetadata(shared(OTHER));
      expect(findings.find((f) => f.code === 'CANONICAL_TARGET_NOT_OK')?.details).toMatchObject({ noindex: true });
    });

    it('is raised when the target sends X-Robots-Tag: none', async () => {
      target({ headers: new Headers({ 'x-robots-tag': 'none' }) });
      const findings = await auditMetadata(shared(OTHER));
      expect(findings.find((f) => f.code === 'CANONICAL_TARGET_NOT_OK')?.details).toMatchObject({ noindex: true });
    });

    it('is not raised when the target answers 200 and is indexable', async () => {
      target({});
      const findings = await auditMetadata(shared(OTHER));
      expect(codes(findings)).not.toContain('CANONICAL_TARGET_NOT_OK');
    });

    it('is not raised when the target cannot be fetched', async () => {
      mockFetchPage.mockRejectedValue(new Error('refused'));
      const findings = await auditMetadata(shared(OTHER));
      expect(codes(findings)).not.toContain('CANONICAL_TARGET_NOT_OK');
    });

    it('does not request a canonical on another host', async () => {
      await auditMetadata(shared(page('<link rel="canonical" href="https://other.example/">')));
      expect(mockFetchPage).not.toHaveBeenCalled();
    });

    it('passes the shared fetch options through', async () => {
      target({});
      const fetchOptions = { timeout: 5, auditedUrl: 'https://example.com/' };
      await auditMetadata({ ...shared(OTHER), fetchOptions });
      expect(mockFetchPage).toHaveBeenCalledWith('https://example.com/other', fetchOptions);
    });
  });

  describe('CANONICAL_NOINDEX_CONFLICT', () => {
    it('is raised for a noindex page whose canonical names another URL', async () => {
      target({});
      const findings = await auditMetadata(
        shared(page('<meta name="robots" content="noindex"><link rel="canonical" href="https://example.com/other">')),
      );
      const conflict = findings.find((f) => f.code === 'CANONICAL_NOINDEX_CONFLICT');
      expect(conflict?.severity).toBe('error');
      expect(conflict?.details).toEqual({ canonical: 'https://example.com/other', source: 'meta' });
    });

    it('is raised when the noindex comes from X-Robots-Tag', async () => {
      target({});
      const findings = await auditMetadata(
        shared(page('<link rel="canonical" href="https://example.com/other">'), { 'x-robots-tag': 'noindex' }),
      );
      expect(findings.find((f) => f.code === 'CANONICAL_NOINDEX_CONFLICT')?.details).toMatchObject({ source: 'header' });
    });

    it('is not raised for a noindex page with a self-referencing canonical', async () => {
      const findings = await auditMetadata(
        shared(page('<meta name="robots" content="noindex"><link rel="canonical" href="https://example.com/">')),
      );
      expect(codes(findings)).not.toContain('CANONICAL_NOINDEX_CONFLICT');
    });
  });
});
